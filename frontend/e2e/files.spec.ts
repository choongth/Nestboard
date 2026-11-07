// Import from and export to local JSON files (File menu). Saving and opening
// on the server are in server.spec.ts.

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SCHEMA_VERSION } from "../src/model/types";
import {
  center,
  check,
  clickBlank,
  createBox,
  cutLiveConnections,
  drag,
  enter,
  expect,
  fileMenu,
  goBack,
  handle,
  nodeNamed,
  openApp,
  readDiagram,
  synced,
  test,
} from "./helpers";

/** What the fake disk behind the file pickers records. */
interface FakeFs {
  files: Record<string, string>;
  saveCalls: number;
  suggested: (string | undefined)[];
  /** Name the next save picker returns (default: the suggested name). */
  saveName: string | null;
  /** Name the next open picker returns. */
  openName: string | null;
  /** Make the next picker behave as if the user cancelled. */
  cancelNext: boolean;
}

declare global {
  interface Window {
    __fs: FakeFs;
  }
}

/** Real pickers cannot be clicked in an automated browser, so they are replaced by this. */
function installFakeFs() {
  const fs: FakeFs = (window.__fs = {
    files: {},
    saveCalls: 0,
    suggested: [],
    saveName: null,
    openName: null,
    cancelNext: false,
  });
  const cancelled = () => {
    if (!fs.cancelNext) return false;
    fs.cancelNext = false;
    return true;
  };
  const handle = (name: string) =>
    ({
      kind: "file",
      name,
      async createWritable() {
        let buffer = "";
        return {
          async write(text: string) {
            buffer += text;
          },
          async close() {
            fs.files[name] = buffer;
          },
        };
      },
      async getFile() {
        return new File([fs.files[name] ?? ""], name);
      },
    }) as unknown as FileSystemFileHandle;

  window.showSaveFilePicker = async (options) => {
    fs.saveCalls++;
    fs.suggested.push(options?.suggestedName);
    if (cancelled()) throw new DOMException("cancelled", "AbortError");
    return handle(fs.saveName ?? options?.suggestedName ?? "untitled.json");
  };
  window.showOpenFilePicker = async () => {
    if (cancelled()) throw new DOMException("cancelled", "AbortError");
    return [handle(fs.openName!)];
  };
}

const fakeFs = (page: Page) => page.evaluate(() => window.__fs);
const setFakeFs = (page: Page, patch: Partial<FakeFs>) =>
  page.evaluate((p) => Object.assign(window.__fs, p), patch);
const fileLabel = (page: Page) => page.getByRole("button", { name: /^File:/ }).getAttribute("aria-label");
const savedJson = async (page: Page, name: string) => JSON.parse((await fakeFs(page)).files[name] ?? "null");
const dialogSays = (page: Page, text: string) => page.getByRole("alertdialog").getByText(text).isVisible();

/** File actions run asynchronously after the click; give them a moment. */
async function menu(page: Page, item: string) {
  await fileMenu(page, item);
  await page.waitForTimeout(200);
}

test("export and import with the File System Access API", async ({ page }) => {
  await page.addInitScript(installFakeFs);
  await openApp(page);

  check(
    "starts as Untitled, clean",
    (await fileLabel(page)) === "File: Untitled" && (await page.title()) === "Untitled — Nestboard",
    `${await fileLabel(page)} | ${await page.title()}`,
  );

  // Something with every kind of content: boxes, a labelled line, nesting.
  await createBox(page, 400, 300, "Web app");
  await createBox(page, 950, 300, "API");
  await page.mouse.move(400, 300);
  await drag(page, await center(handle(page, "Web app", "right")), await center(handle(page, "API", "left")));
  await page.keyboard.type("Calls");
  await page.keyboard.press("Enter");
  await clickBlank(page);
  await enter(page, "API");
  await createBox(page, 600, 400, "Router");
  await goBack(page);
  await synced(page);
  check(
    "a new diagram goes to the server with its first change: nothing shows as unsaved",
    (await fileLabel(page)) === "File: Untitled" && !(await page.title()).startsWith("● "),
    `${await fileLabel(page)} | ${await page.title()}`,
  );

  await test.step("Export writes the diagram to a file, named after it", async () => {
    await setFakeFs(page, { saveName: "shop.json" });
    await menu(page, "Export to file…");
    const fs = await fakeFs(page);
    check("Export asks where, suggesting Untitled.json", fs.saveCalls === 1 && fs.suggested[0] === "Untitled.json");
    const saved = await savedJson(page, "shop.json");
    check(
      "the file holds the nested diagram",
      saved?.schemaVersion === SCHEMA_VERSION &&
        saved.root.children.length === 2 &&
        saved.root.edges[0]?.label === "Calls" &&
        saved.root.children.find((c: { title: string }) => c.title === "API")?.children[0]?.title === "Router",
    );
    await setFakeFs(page, { cancelNext: true });
    await menu(page, "Export to file…");
    check("cancelling Export shows no error", !(await page.getByRole("alertdialog").isVisible()));
  });

  await test.step("exporting mid-typing includes what is being typed", async () => {
    await nodeNamed(page, "API").click();
    await page.getByLabel("Name").fill("Backend API");
    await page.getByRole("button", { name: /^File:/ }).click();
    await page.getByRole("menuitem", { name: "Export to file…" }).click();
    await page.waitForTimeout(200);
    check("the typed name is in the file", (await fakeFs(page)).files["shop.json"]!.includes("Backend API"));
    await clickBlank(page);
  });

  await test.step("Import loads the file as a new diagram, which goes to the server", async () => {
    // Everything saved itself: nothing to ask about (New lets the last change arrive first).
    await menu(page, "New diagram");
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    check("New asks nothing", !(await page.getByRole("alertdialog").isVisible()));
    await setFakeFs(page, { openName: "shop.json" });
    await menu(page, "Import from file…");
    await expect(nodeNamed(page, "Web app")).toBeVisible();
    const opened = await readDiagram(page);
    check(
      "the file's content is back",
      opened.titles.join() === "Backend API,Router,Web app",
      JSON.stringify(opened.titles),
    );
    await synced(page);
    check("named after the file, and on the server", (await fileLabel(page)) === "File: shop", (await fileLabel(page)) ?? "");
    check("no undo history", opened.past === 0);
    check("the connection and its label are back", await page.locator(".react-flow__edgelabel-renderer").getByText("Calls").isVisible());
    check("nested content is back", (await nodeNamed(page, "Backend API").locator("[title='1 nested box']").count()) === 1);
    const onScreen = async (name: string) => {
      const b = (await nodeNamed(page, name).boundingBox())!;
      return b.x >= 0 && b.y >= 48 && b.x + b.width <= 1400 && b.y + b.height <= 860;
    };
    check("the imported diagram is fitted on screen", (await onScreen("Web app")) && (await onScreen("Backend API")));
  });

  await test.step("bad files show an error and change nothing", async () => {
    await menu(page, "New diagram");
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await page.evaluate(() => {
      window.__fs.files["broken.json"] = "{ not json";
      window.__fs.files["other.json"] = JSON.stringify({ hello: "world" });
    });
    await setFakeFs(page, { openName: "broken.json" });
    await menu(page, "Import from file…");
    check("invalid JSON shows an error", await dialogSays(page, "The file is not valid JSON."));
    await page.getByRole("button", { name: "OK" }).click();
    await setFakeFs(page, { openName: "other.json" });
    await menu(page, "Import from file…");
    check("a non-Nestboard file shows an error", await dialogSays(page, "This is not a Nestboard file."));
    await page.getByRole("button", { name: "OK" }).click();
    check(
      "a failed import leaves the diagram alone",
      (await readDiagram(page)).titles.length === 0 && (await fileLabel(page)) === "File: Untitled",
    );
  });

  // Reload, not close: this headless browser skips beforeunload when a page is closed.
  await test.step("leaving the page with changes that could not reach the server warns", async () => {
    // The new diagram goes to the server with its first box; nothing after that gets through.
    await cutLiveConnections(page);
    await createBox(page, 300, 400, "Saved");
    await page.waitForFunction(() => window.__nestboard!.documentStore.getState().id !== null);
    await createBox(page, 600, 400, "Unsaved");
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void d.dismiss(); // "stay on page"
    });
    await page.reload({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
    check(
      "leaving with unsaved changes warns",
      dialogs.join() === "beforeunload" && (await readDiagram(page)).titles.includes("Unsaved"),
    );
  });
});

test("export and import without the File System Access API (Firefox, Safari)", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });
  await openApp(page);

  await createBox(page, 500, 400, "Offline");
  const [download] = await Promise.all([page.waitForEvent("download"), fileMenu(page, "Export to file…")]);
  const path = testInfo.outputPath("download.json");
  await download.saveAs(path);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  check(
    "Export downloads the file, named after the diagram",
    download.suggestedFilename() === "Untitled.json" && saved.root.children[0]?.title === "Offline",
  );

  // The diagram saved itself: Import asks nothing.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), fileMenu(page, "Import from file…")]);
  // Written in the older format 1 (before box types), which must still import.
  const twoBoxes = {
    schemaVersion: 1,
    root: {
      id: "r",
      title: "Root",
      position: { x: 0, y: 0 },
      edges: [],
      children: [
        { id: "a", title: "A", position: { x: 0, y: 0 }, children: [], edges: [] },
        { id: "b", title: "B", position: { x: 300, y: 0 }, children: [], edges: [] },
      ],
    },
  };
  await chooser.setFiles({ name: "from-disk.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(twoBoxes)) });
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await synced(page);
  check("Import goes through a file chooser", (await fileLabel(page)) === "File: from-disk", (await fileLabel(page)) ?? "");
});
