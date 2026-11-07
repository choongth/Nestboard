// Diagrams on the server: they save themselves as they are made, and everyone
// with one open sees each change as it happens (the live connection; see
// src/files/liveDiagram.ts). Also the File menu, Ctrl+O and the ?diagram=
// address. Runs against the real backend on the test database; see
// playwright.config.ts.

import type { APIRequestContext, Page, WebSocketRoute } from "@playwright/test";
import type { DiagramRecord } from "../src/api/diagrams";
import {
  BASE,
  check,
  clickBlank,
  createBox,
  drag,
  DIAGRAMS_API,
  drained,
  expect,
  fileMenu,
  nodeNamed,
  openApp,
  readDiagram,
  synced,
  test,
  watchConsole,
} from "./helpers";

const fileLabel = (page: Page) => page.getByRole("button", { name: /^File:/ }).getAttribute("aria-label");
const openId = (page: Page) => new URL(page.url()).searchParams.get("diagram");
const fromServer = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/diagrams/${id}`)).json()) as DiagramRecord;
/** The titles of the boxes on the top level. */
const titlesIn = (d: DiagramRecord) =>
  d.boxes
    .filter((b) => b.parent_id === d.root_id)
    .map((b) => b.title)
    .sort();
const dialogSays = (page: Page, text: string) => page.getByRole("alertdialog").getByText(text).isVisible();
const titlesOf = async (page: Page) => (await readDiagram(page)).titles.join();

/** A diagram made on the server with top-level boxes titled `titles` (ids: their lower-case names). */
async function makeDiagram(request: APIRequestContext, name: string, ...titles: string[]) {
  const children = titles.map((title, i) => ({
    id: title.toLowerCase(),
    title,
    position: { x: i * 400, y: 0 },
    children: [],
    edges: [],
  }));
  const document = { schemaVersion: 5, root: { id: "r", title: "Root", position: { x: 0, y: 0 }, children, edges: [] } };
  return (await (await request.post(DIAGRAMS_API, { data: { name, document } })).json()) as DiagramRecord;
}

/** Someone else, through the API: makes changes on top of whatever is there. */
async function theyChange(request: APIRequestContext, id: string, changes: Record<string, unknown>) {
  const saved = await request.post(`/api/v1/diagrams/${id}/changes`, { data: changes });
  expect(saved.ok()).toBe(true);
}

test("a diagram saves itself as it is made; rename, open and reopen by link", async ({ page, request }) => {
  const name = `E2E shop ${Date.now()}`;
  await openApp(page);
  check("a new diagram has no address of its own", openId(page) === null);
  await createBox(page, 400, 300, "Web app");
  await createBox(page, 900, 300, "API");

  let id = "";
  await test.step("its first change takes it to the server, and the rest follow", async () => {
    await synced(page);
    id = openId(page) ?? "";
    check("the address now names it", /^[0-9a-f-]{36}$/.test(id), page.url());
    const stored = await fromServer(request, id);
    check("the server has it all", stored.name === "Untitled" && titlesIn(stored).join() === "API,Web app");
    check("nothing shows as unsaved", (await fileLabel(page)) === "File: Untitled" && (await page.title()) === "Untitled — Nestboard");
  });

  await test.step("Rename renames it on the server", async () => {
    await fileMenu(page, "Rename…");
    await page.getByLabel("Diagram name").fill(name);
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(`File: ${name}`);
    check("renamed on the server", (await fromServer(request, id)).name === name);
  });

  const y = (d: DiagramRecord) => d.boxes.find((b) => b.title === "Web app")!.position.y;
  await test.step("a move goes at once, and so does its undo", async () => {
    const before = await fromServer(request, id);
    await drag(page, { x: 400, y: 300 }, { x: 450, y: 600 });
    await synced(page);
    const moved = await fromServer(request, id);
    check("moved on the server", moved.version > before.version && y(moved) > y(before));
    await page.keyboard.press("Control+z");
    await drained(page);
    await synced(page);
    check("undone on the server too", y(await fromServer(request, id)) === y(before));
    check("the address did not change", openId(page) === id);
  });

  await test.step("a name goes while it is being typed", async () => {
    await nodeNamed(page, "API").click();
    await page.getByLabel("Name").fill("Backend API");
    await expect.poll(async () => titlesIn(await fromServer(request, id)).join()).toBe("Backend API,Web app");
    await clickBlank(page);
  });

  await test.step("New starts an empty diagram with no address", async () => {
    await fileMenu(page, "New diagram");
    check("empty and untitled", (await readDiagram(page)).titles.length === 0 && (await fileLabel(page)) === "File: Untitled");
    check("the address no longer names a diagram", openId(page) === null);
  });

  await test.step("Ctrl+O lists the server's diagrams; picking one opens it", async () => {
    await createBox(page, 500, 400, "Scratch");
    await page.keyboard.press("Control+o");
    const dialog = page.getByRole("dialog", { name: "Open diagram" });
    await expect(dialog.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    await dialog.getByLabel("Search diagrams").fill(name.slice(-8));
    await expect(dialog.getByRole("listitem")).toHaveCount(1);
    await dialog.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(`File: ${name}`);
    check("nothing to discard: Scratch saved itself", !(await page.getByRole("alertdialog").isVisible()));
    const opened = await readDiagram(page);
    check("its content is back", opened.titles.join() === "Backend API,Web app", JSON.stringify(opened.titles));
    check("with no undo history", opened.past === 0);
    check("the address names it", openId(page) === id);
  });

  await test.step("the address reopens it after a reload", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(`File: ${name}`);
    check("same content", (await titlesOf(page)) === "Backend API,Web app");
    await expect(nodeNamed(page, "Web app")).toBeInViewport();
  });

  await test.step("the Decisions page keeps the diagram open", async () => {
    await page.getByRole("button", { name: /^Page: / }).click();
    await page.getByRole("menuitem", { name: /Decisions/ }).click();
    check("the address keeps the diagram", new URL(page.url()).pathname === `${BASE}/decisions` && openId(page) === id);
    await expect(page.getByRole("navigation", { name: "Decisions" })).toBeVisible();
    await page.goBack();
    check("back in the editor, still the same diagram", (await titlesOf(page)) === "Backend API,Web app");
  });

  // Reload, not close: this headless browser skips beforeunload when a page is closed.
  await test.step("leaving a diagram whose changes arrived does not warn", async () => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.reload();
    await page.locator(".react-flow__pane").waitFor();
    check("no warning", dialogs.length === 0);
  });
});

test("two people on one diagram see each other's changes as they make them", async ({ page, request }) => {
  const diagram = await makeDiagram(request, `E2E together ${Date.now()}`, "Shop", "Web");
  const other = await page.context().newPage();
  const otherErrors = watchConsole(other);
  for (const tab of [page, other]) {
    await tab.goto(`${BASE}/editor?diagram=${diagram.id}`);
    await tab.locator(".react-flow__pane").waitFor();
    await expect(nodeNamed(tab, "Web")).toBeVisible();
  }

  await test.step("a name typed in one shows in the other", async () => {
    await nodeNamed(other, "Shop").click();
    await other.getByLabel("Name").fill("Checkout");
    await other.keyboard.press("Enter");
    await expect(nodeNamed(page, "Checkout")).toBeVisible();
  });

  await test.step("a box moved or added in one moves or appears in the other", async () => {
    const before = (await nodeNamed(other, "Web").boundingBox())!;
    await drag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 }, { x: before.x + 200, y: before.y + 250 });
    await expect.poll(async () => (await nodeNamed(other, "Web").boundingBox())!.y).toBeGreaterThan(before.y + 150);
    await createBox(page, 700, 650, "Payments");
    await expect(nodeNamed(other, "Payments")).toBeVisible();
  });

  await test.step("undo takes back only your own change", async () => {
    // The rename was the other tab's; the move and the new box were this one's.
    await clickBlank(other);
    await other.keyboard.press("Control+z");
    await expect(nodeNamed(page, "Shop")).toBeVisible();
    check("this tab's box stays in both", (await titlesOf(page)).includes("Payments") && (await titlesOf(other)).includes("Payments"));
  });

  await test.step("a change made through the API shows in both", async () => {
    await theyChange(request, diagram.id, { changed_boxes: [{ id: "web", title: "Storefront" }] });
    for (const tab of [page, other]) await expect(nodeNamed(tab, "Storefront")).toBeVisible();
  });

  await synced(page);
  await synced(other);
  check("the server has what both see", titlesIn(await fromServer(request, diagram.id)).join() === (await titlesOf(other)));
  await other.close();
  expect(otherErrors, "browser console errors in the other tab").toEqual([]);
});

test("a lost connection, links to missing diagrams, and an unreachable server", async ({ page, request }) => {
  await test.step("a link to a missing diagram explains, and drops the bad address", async () => {
    await page.goto(`${BASE}/editor?diagram=00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole("alertdialog")).toContainText("This diagram doesn't exist");
    await page.getByRole("button", { name: "OK" }).click();
    check("the address no longer names it", openId(page) === null);
    check("the editor works on a new diagram", (await fileLabel(page)) === "File: Untitled");
  });

  // Not "offline" in the name: the File menu says that when the connection is lost.
  const diagram = await makeDiagram(request, `E2E connection ${Date.now()}`, "Shop");
  const elsewhere = await makeDiagram(request, `E2E elsewhere ${Date.now()}`, "Other");
  // Every live connection goes through here: while `up` is false, none gets through.
  let up = true;
  const routes: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/v1\/diagrams\/[^/]+\/live$/, (route) => {
    routes.push(route);
    if (up) route.connectToServer();
  });
  await page.goto(`${BASE}/editor?diagram=${elsewhere.id}`);
  await expect(nodeNamed(page, "Other")).toBeVisible();
  // Opened from the app, so going back stays in it.
  await page.keyboard.press("Control+o");
  await page.getByLabel("Search diagrams").fill(diagram.name);
  await page.getByRole("dialog").getByRole("button").filter({ hasText: diagram.name }).first().click();
  await expect(nodeNamed(page, "Shop")).toBeVisible();

  await test.step("when the connection goes, the editor says so, and keeps the changes made meanwhile", async () => {
    up = false;
    await routes.at(-1)!.close();
    // Away from Shop, which fills the middle of the screen on its own.
    await createBox(page, 200, 760, "While offline");
    await expect(page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(/offline/);
    await expect(page).toHaveTitle(/^● /);
  });

  await test.step("going to another diagram meanwhile asks first", async () => {
    await page.goBack();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    check("asks before discarding", await dialogSays(page, "The link points at another diagram"));
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => openId(page)).toBe(diagram.id);
    check("kept my changes", (await titlesOf(page)).includes("While offline"));
  });

  await test.step("back online: what was made meanwhile goes, and what others did shows", async () => {
    await theyChange(request, diagram.id, { changed_boxes: [{ id: "shop", title: "Checkout" }] });
    up = true;
    await routes.at(-1)!.close(); // the waiting connection gives up; the next one gets through
    await synced(page);
    await expect(nodeNamed(page, "Checkout")).toBeVisible();
    check("the server has both", titlesIn(await fromServer(request, diagram.id)).join() === "Checkout,While offline");
    await expect(page.getByRole("button", { name: /^File:/ })).not.toHaveAccessibleName(/offline/);
  });

  await test.step("a server that cannot be reached is explained when opening", async () => {
    up = false;
    await page.unrouteAll();
    await page.routeWebSocket(/\/api\/v1\/diagrams\/[^/]+\/live$/, (route) => route.close());
    await page.goto(`${BASE}/editor?diagram=${elsewhere.id}`);
    await expect(page.getByRole("alertdialog")).toContainText("Can't reach the Nestboard server. Is it running?");
    await page.getByRole("button", { name: "OK" }).click();
  });
});
