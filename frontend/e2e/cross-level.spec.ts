// Lines between boxes on different levels ("跨层级连线"): valid data (step 1),
// drawn lifted on higher levels (step 3), created through "Connect to…" (step 4),
// and shown from inside a box going to external boxes around it.

import { writeFileSync } from "node:fs";
import type { DiagramFile, FileNode } from "../src/model/types";
import { SCHEMA_VERSION } from "../src/model/types";
import type { Page } from "@playwright/test";
import {
  center,
  check,
  clickBlank,
  crumbs,
  drag,
  drained,
  enter,
  goBack,
  handle,
  settled,
  openApp,
  openFileViaChooser,
  readDiagram,
  redo,
  saveViaDownload,
  test,
  undo,
  useFileFallback,
} from "./helpers";

const fileNode = (id: string, title: string, extra: Partial<FileNode> = {}): FileNode => ({
  id,
  title,
  position: { x: 0, y: 0 },
  children: [],
  edges: [],
  ...extra,
});

/** Root › Shop › Cart and Root › Payments › Ledger, with Cart → Ledger stored on the root. */
const SHOP: DiagramFile = {
  schemaVersion: SCHEMA_VERSION,
  root: fileNode("root", "Root", {
    children: [
      fileNode("shop", "Shop", { children: [fileNode("cart", "Cart")] }),
      fileNode("payments", "Payments", { position: { x: 400, y: 0 }, children: [fileNode("ledger", "Ledger")] }),
    ],
    edges: [
      { id: "across", from: "cart", to: "ledger", label: "pays via" },
      { id: "same-level", from: "shop", to: "payments" },
    ],
  }),
};

test("a line between levels loads, breaks nothing, and is kept on save", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("shop.json");
  writeFileSync(path, JSON.stringify(SHOP));
  await openFileViaChooser(page, path);

  check("opens without an error", !(await page.getByRole("alertdialog").isVisible()));
  const across = (await readDiagram(page)).edges.find((e) => e.id === "across");
  check("the line between levels is in the diagram", across?.fromTitle === "Cart" && across.toTitle === "Ledger");
  check("…stored on the root, their lowest common ancestor", across?.parentId === "root");
  check("both lines are drawn at the root", (await page.locator(".react-flow__edge").count()) === 2);

  // Walking into both boxes must not trip over the line that crosses them.
  await enter(page, "Shop");
  await goBack(page);
  await enter(page, "Payments");
  await goBack(page);

  const saved = await saveViaDownload(page);
  check("saved in the current format", saved.schemaVersion === SCHEMA_VERSION);
  check(
    "the line is saved on the root, unchanged",
    JSON.stringify(saved.root.edges.find((e) => e.id === "across")) ===
      JSON.stringify({ id: "across", from: "cart", to: "ledger", label: "pays via" }),
  );
});

/**
 * Root ─┬─ Shop ─┬─ Cart          Lines: Shop → Payments "checkout" (same level)
 *       │        └─ Wishlist             Cart → Ledger "pays via"  (lifted at Root)
 *       ├─ Payments ─┬─ Ledger           Fraud → Wishlist          (lifted, opposite way)
 *       │            └─ Fraud            Ledger → Fraud "checks"   (inside Payments)
 *       └─ Users                         Users → Shop
 */
const LIFTING: DiagramFile = {
  schemaVersion: SCHEMA_VERSION,
  root: fileNode("root", "Root", {
    children: [
      fileNode("shop", "Shop", { children: [fileNode("cart", "Cart"), fileNode("wish", "Wishlist", { position: { x: 0, y: 220 } })] }),
      fileNode("payments", "Payments", {
        position: { x: 520, y: 0 },
        children: [fileNode("ledger", "Ledger"), fileNode("fraud", "Fraud", { position: { x: 360, y: 0 } })],
        edges: [{ id: "inside", from: "ledger", to: "fraud", label: "checks" }],
      }),
      fileNode("users", "Users", { position: { x: 0, y: 340 } }),
    ],
    edges: [
      { id: "direct", from: "shop", to: "payments", label: "checkout" },
      { id: "across", from: "cart", to: "ledger", label: "pays via" },
      { id: "back", from: "fraud", to: "wish" },
      { id: "visit", from: "users", to: "shop" },
    ],
  }),
};

const edgeLine = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);
/** Where a drawn line starts, from its SVG path. */
const startOf = async (page: Page, id: string) =>
  (await edgeLine(page, id).locator("path.nb-connection").getAttribute("d"))!
    .match(/^M\s*([-\d.]+)[ ,]([-\d.]+)/)!
    .slice(1)
    .map(Number);

test("lines between levels are drawn lifted, side by side, and can be edited from any level", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("lifting.json");
  writeFileSync(path, JSON.stringify(LIFTING));
  await openFileViaChooser(page, path);

  await test.step("at the root, deeper lines are lifted to the boxes containing their ends", async () => {
    const drawn = await page.locator(".react-flow__edge").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort());
    check("all four root-level lines are drawn", JSON.stringify(drawn) === '["across","back","direct","visit"]', JSON.stringify(drawn));
    check("the line inside Payments is not drawn here", (await edgeLine(page, "inside").count()) === 0);
    check("lifted lines are faded", (await edgeLine(page, "across").getAttribute("class"))!.includes("nb-lifted") && (await edgeLine(page, "back").getAttribute("class"))!.includes("nb-lifted"));
    check("the same-level line is not", !(await edgeLine(page, "direct").getAttribute("class"))!.includes("nb-lifted"));
    const label = page.locator("[data-edge-label]").filter({ hasText: "pays via" });
    check("a lifted line's label fades with it", (await label.getAttribute("class"))!.includes("opacity-50"));
  });

  await test.step("lines between the same two boxes sit side by side", async () => {
    const starts = await Promise.all(["direct", "across", "back"].map((id) => startOf(page, id)));
    const ys = starts.map(([, y]) => Math.round(y!));
    check("three separate tracks", new Set(ys).size === 3, JSON.stringify(starts));
  });

  await test.step("selecting a lifted line shows its real ends", async () => {
    await page.locator(".react-flow__edgelabel-renderer").getByText("pays via").click();
    const ends = await page.locator("aside [data-connection-ends]").innerText();
    check("real ends with their paths", ends.includes("Shop › Cart") && ends.includes("Payments › Ledger"), ends);
    check("says where it is drawn", (await page.locator("aside [data-lifted-note]").innerText()).includes("between Shop and Payments"));
    check("selected, it is no longer faded", !(await edgeLine(page, "across").getAttribute("class"))!.includes("nb-lifted"));
    await page.getByLabel("Label").fill("settles via");
    await page.keyboard.press("Enter");
    check("its label can be edited here", (await readDiagram(page)).edges.find((e) => e.id === "across")?.label === "settles via");
  });

  await test.step("deleting it here removes the real line; undo brings it back", async () => {
    await page.getByRole("button", { name: "Delete connection" }).click();
    check("deleted", !(await readDiagram(page)).edges.some((e) => e.id === "across"));
    await page.keyboard.press("Control+z");
    await drained(page);
    check("undo restores it", (await readDiagram(page)).edges.some((e) => e.id === "across"));
  });

  await test.step("inside a box, its own lines are drawn normally; lines leaving it go to external boxes", async () => {
    await clickBlank(page);
    await enter(page, "Payments");
    const drawn = await page.locator(".react-flow__edge").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort());
    check("its own line plus the two leaving it", JSON.stringify(drawn) === '["across","back","inside"]', JSON.stringify(drawn));
    check("its own line is not faded", !(await edgeLine(page, "inside").getAttribute("class"))!.includes("nb-lifted"));
    await goBack(page);
    await enter(page, "Shop");
  });

  await test.step("undoing a change to a deep line goes to where it is drawn and highlights it", async () => {
    // Shop › Cart → Payments › Ledger is drawn at Root; change it while inside Shop.
    await page.evaluate(() => window.__nestboard!.diagramStore.getState().setConnectionLabel("across", "renamed"));
    await page.keyboard.press("Control+z");
    const pulsed = await edgeLine(page, "across")
      .locator(".nb-highlight-edge")
      // "attached": a blurred, unfilled SVG line does not count as visible to Playwright.
      .waitFor({ state: "attached", timeout: 1000 })
      .then(() => true, () => false);
    await drained(page);
    check("undo goes to the root, where the line is drawn", JSON.stringify(await crumbs(page)) === '["Root"]', JSON.stringify(await crumbs(page)));
    check("…and highlights it", pulsed);
  });
});

test("dropping a line on a box with boxes inside asks which one to connect to", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("connect.json");
  writeFileSync(path, JSON.stringify(LIFTING));
  await openFileViaChooser(page, path);

  const menu = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/^Search inside/) });
  const offered = async () => (await menu.locator("[data-target-name]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const groupNames = () => menu.locator("[cmdk-group-heading]").allInnerTexts();
  const edgeCount = async () => (await readDiagram(page)).edges.length;
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name }).first();
  /** Drags a line from one box's point onto the middle of another box. */
  async function dropOn(from: string, side: "top" | "right" | "bottom" | "left", onto: string) {
    await node(from).hover();
    await drag(page, await center(handle(page, from, side)), await center(node(onto)));
  }

  await test.step("the list holds only the box dropped on and the boxes inside it", async () => {
    await dropOn("Shop", "right", "Payments");
    await menu.waitFor();
    check("says what is being connected", (await menu.innerText()).includes("Connect Shop to…"));
    check("search is scoped to the box", (await menu.getByPlaceholder("Search inside Payments…").count()) === 1);
    check("grouped: this box, then inside it", JSON.stringify(await groupNames()) === '["THIS BOX","INSIDE PAYMENTS"]', JSON.stringify(await groupNames()));
    const names = await offered();
    check("only Payments, Ledger and Fraud", JSON.stringify(names) === '["Payments","Ledger","Fraud"]', JSON.stringify(names));
  });

  await test.step("Esc closes it without connecting", async () => {
    const before = await edgeCount();
    await page.keyboard.press("Escape");
    check("closed", !(await menu.isVisible()));
    check("nothing connected", (await edgeCount()) === before);
  });

  await test.step("picking a box inside connects to it, as one undo step", async () => {
    const past = (await readDiagram(page)).past;
    await dropOn("Shop", "right", "Payments");
    await menu.waitFor();
    await page.keyboard.type("led");
    check("search narrows to Ledger", JSON.stringify(await offered()) === '["Ledger"]', JSON.stringify(await offered()));
    await page.keyboard.press("Enter");
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Shop → Ledger made", made.fromTitle === "Shop" && made.toTitle === "Ledger");
    check("stored on the root", made.parentId === "root");
    check("drawn here, lifted to Payments", (await page.locator(`.react-flow__edge[data-id="${made.id}"]`).count()) === 1);
    check("the label field is ready for typing", await page.getByLabel("Label").evaluate((el) => el === document.activeElement));
    check("one undo step", (await readDiagram(page)).past === past + 1);
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("picking the box itself connects to it", async () => {
    await dropOn("Users", "right", "Payments");
    await menu.waitFor();
    await page.keyboard.press("Enter"); // the box itself is listed first
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Users → Payments made", made.fromTitle === "Users" && made.toTitle === "Payments");
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("↑ and ↓ move through the list, Enter connects to the highlighted box", async () => {
    await dropOn("Users", "right", "Payments");
    await menu.waitFor();
    const highlighted = async () => (await menu.locator("[cmdk-item][data-selected='true'] [data-target-name]").innerText()).trim();
    check("starts on the box itself", (await highlighted()) === "Payments", await highlighted());
    await page.keyboard.press("ArrowDown");
    check("↓ moves down", (await highlighted()) === "Ledger", await highlighted());
    await page.keyboard.press("ArrowDown");
    check("↓ again", (await highlighted()) === "Fraud", await highlighted());
    await page.keyboard.press("ArrowUp");
    check("↑ moves back up", (await highlighted()) === "Ledger", await highlighted());
    await page.keyboard.press("Enter");
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Users → Ledger made", made.fromTitle === "Users" && made.toTitle === "Ledger");
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("a box with nothing inside connects straight away", async () => {
    const before = await edgeCount();
    await dropOn("Payments", "bottom", "Users");
    await page.waitForTimeout(200);
    check("no list", !(await menu.isVisible()));
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("connected", (await edgeCount()) === before + 1 && made.fromTitle === "Payments" && made.toTitle === "Users");
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("dropping on empty canvas does nothing", async () => {
    const before = await edgeCount();
    await node("Users").hover();
    await drag(page, await center(handle(page, "Users", "bottom")), { x: 1200, y: 780 });
    await page.waitForTimeout(200);
    check("no list", !(await menu.isVisible()));
    check("nothing connected", (await edgeCount()) === before);
  });

  await test.step("inside a box, it works the same on that level", async () => {
    await enter(page, "Payments");
    await page.evaluate(() => {
      // Give Fraud something inside it, so dropping on it asks.
      const store = window.__nestboard!.diagramStore.getState();
      const fraud = Object.values(store.diagram.nodes).find((n) => n.title === "Fraud")!;
      const rules = store.addBox(fraud.id, { x: 0, y: 0 });
      store.updateBox(rules, { title: "Rules" });
    });
    await dropOn("Ledger", "right", "Fraud");
    await menu.waitFor();
    check("offers Fraud and what is inside it", JSON.stringify(await offered()) === '["Fraud","Rules"]', JSON.stringify(await offered()));
    await page.keyboard.type("rules");
    await page.keyboard.press("Enter");
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Ledger → Rules, stored inside Payments", made.fromTitle === "Ledger" && made.toTitle === "Rules" && made.parentId === "payments");
    check("drawn here, lifted to Fraud", (await page.locator(`.react-flow__edge[data-id="${made.id}"]`).count()) === 1);
  });
});

test("inside a box, lines leaving it go to external boxes for their exact far ends", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("external.json");
  writeFileSync(path, JSON.stringify(LIFTING));
  await openFileViaChooser(page, path);
  await enter(page, "Shop");

  // Matched on the name alone: paths ("Payments › Ledger") also contain other boxes' names.
  const external = (name: string) =>
    page.locator("[data-external-box]").filter({ has: page.locator("[data-box-title]", { hasText: new RegExp(`^${name}$`) }) });
  const externalNames = () => page.locator("[data-external-box] [data-box-title]").allInnerTexts();
  const placeholder = page.locator("[data-external-placeholder]");
  const menu = page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search other levels…") });
  const offered = async () => (await menu.locator("[data-target-name]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  /**
   * Drags a line from a box's point onto the "External box…" placeholder,
   * which only appears once dragging has started. Returns where the
   * placeholder was, relative to the box the line came from.
   */
  async function dropOnPlaceholder(from: string, side: "top" | "right" | "bottom" | "left") {
    const box = page.locator(".react-flow__node", { hasText: from }).first();
    await box.hover();
    const start = await center(handle(page, from, side));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 40, { steps: 5 });
    await page.waitForTimeout(300); // it appears, and may pan into view
    const target = await center(placeholder);
    const origin = await center(box);
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.up();
    return { x: target.x - origin.x, y: target.y - origin.y };
  }

  await test.step("each far end shows as itself, with its path", async () => {
    check("Ledger and Fraud, not their container", JSON.stringify(await externalNames()) === '["Ledger","Fraud"]', JSON.stringify(await externalNames()));
    check("Ledger's path", (await external("Ledger").locator("[data-external-location]").innerText()) === "Payments › Ledger");
    check("Fraud's path", (await external("Fraud").locator("[data-external-location]").innerText()) === "Payments › Fraud");
    const across = page.locator('.react-flow__edge[data-id="across"]');
    const back = page.locator('.react-flow__edge[data-id="back"]');
    check("Cart → Ledger drawn here", (await across.count()) === 1);
    check("Fraud → Wishlist drawn here", (await back.count()) === 1);
    check("not faded: both ends are drawn as themselves", !(await across.getAttribute("class"))?.includes("nb-lifted") && !(await back.getAttribute("class"))?.includes("nb-lifted"));
    const viewport = page.viewportSize()!;
    const b = (await external("Ledger").boundingBox())!;
    check("on screen after entering", b.x >= 0 && b.x + b.width <= viewport.width && b.y >= 48 && b.y + b.height <= viewport.height);
  });

  await test.step("while dragging a line, only one External box… appears; the connected ones stay", async () => {
    await page.locator(".react-flow__node", { hasText: "Wishlist" }).hover();
    const from = await center(handle(page, "Wishlist", "right"));
    const before = (await external("Ledger").boundingBox())!;
    let during: string[] = [];
    let placeholders = 0;
    let ledgerDuring = before;
    await drag(page, from, { x: from.x + 150, y: from.y + 120 }, {
      midway: async () => {
        during = await externalNames();
        placeholders = await placeholder.count();
        ledgerDuring = (await external("Ledger").boundingBox())!;
      },
    });
    check("no other boxes appear", JSON.stringify(during) === '["Ledger","Fraud"]', JSON.stringify(during));
    check("one placeholder appears", placeholders === 1);
    check("the connected ones stay where they were", Math.abs(ledgerDuring.y - before.y) < 1 && Math.abs(ledgerDuring.x - before.x) < 1);
    check("and it disappears again after", (await placeholder.count()) === 0);
  });

  await test.step("dropping on it lists the other levels, one at a time", async () => {
    await dropOnPlaceholder("Wishlist", "right");
    await menu.waitFor();
    check("the top level, without the box we are in", JSON.stringify(await offered()) === '["Payments","Users"]', JSON.stringify(await offered()));
    // Payments is highlighted first; → opens it.
    await page.keyboard.press("ArrowRight");
    check("inside Payments", JSON.stringify(await offered()) === '["Ledger","Fraud"]', JSON.stringify(await offered()));
    check("the path says where", (await menu.locator("[data-menu-levels]").innerText()).replace(/\s+/g, " ").includes("Root Payments"));
    await page.keyboard.press("Backspace");
    check("Backspace goes back up", JSON.stringify(await offered()) === '["Payments","Users"]', JSON.stringify(await offered()));
    await page.keyboard.type("frau");
    check("search looks at every level", JSON.stringify(await offered()) === '["Payments › Fraud"]', JSON.stringify(await offered()));
    await page.keyboard.press("Escape");
  });

  await test.step("picking a box connects to it, and it takes the placeholder's place", async () => {
    const past = (await readDiagram(page)).past;
    const spotOnScreen = await dropOnPlaceholder("Cart", "bottom");
    await menu.waitFor();
    await menu.getByRole("option", { name: /^Users/ }).click();
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Cart → Users made", made.fromTitle === "Cart" && made.toTitle === "Users");
    check("one undo step", (await readDiagram(page)).past === past + 1);
    check("Users now shows as a far end", (await externalNames()).includes("Users"));
    check("its path names the root", (await external("Users").locator("[data-external-location]").innerText()) === "Root › Users");
    const users = await center(external("Users"));
    const cart = await center(page.locator(".react-flow__node", { hasText: "Cart" }).first());
    const now = { x: users.x - cart.x, y: users.y - cart.y };
    check("where the placeholder was", Math.abs(now.x - spotOnScreen.x) < 3 && Math.abs(now.y - spotOnScreen.y) < 3, JSON.stringify({ now, spotOnScreen }));
    const spot = (await readDiagram(page)).nodes.find((n) => n.id === "shop")!.externals?.users;
    check("…saved as its spot", spot !== undefined);
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("an external box already shown takes lines straight away, and stays put", async () => {
    const before = await center(external("Ledger"));
    const wish = page.locator(".react-flow__node", { hasText: "Wishlist" }).first();
    await wish.hover();
    await drag(page, await center(handle(page, "Wishlist", "right")), before);
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Wishlist → Ledger made from inside Shop", made.fromTitle === "Wishlist" && made.toTitle === "Ledger" && made.parentId === "root");
    check("Ledger did not move", JSON.stringify(await center(external("Ledger"))) === JSON.stringify(before));
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("moving an external box leaves the box itself where it is on its own level", async () => {
    const position = async () => (await readDiagram(page)).nodes.find((n) => n.title === "Ledger")!.position;
    const before = await position();
    const at = await center(external("Ledger"));
    await drag(page, at, { x: at.x - 200, y: at.y + 150 });
    check("Ledger did not move", JSON.stringify(await position()) === JSON.stringify(before));
  });

  await test.step("clicking one shows it in the sidebar; double-clicking goes to it", async () => {
    await clickBlank(page);
    await external("Ledger").click();
    check("sidebar shows the box", (await page.getByLabel("Name").inputValue()) === "Ledger");
    await external("Ledger").dblclick();
    await settled(page);
    check("double-click goes to its level", JSON.stringify(await crumbs(page)) === '["Root","Payments"]', JSON.stringify(await crumbs(page)));
    check("…with it selected", (await page.getByLabel("Name").inputValue()) === "Ledger");
  });

  await test.step("deeper down, the levels above can be opened but not picked", async () => {
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const item = store.addBox("cart", { x: 0, y: 0 });
      store.updateBox(item, { title: "Item" });
    });
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Root" }).click();
    await settled(page);
    await enter(page, "Shop");
    await enter(page, "Cart");
    check("inside Cart", JSON.stringify(await crumbs(page)) === '["Root","Shop","Cart"]', JSON.stringify(await crumbs(page)));
    await dropOnPlaceholder("Item", "right");
    await menu.waitFor();
    const top = await offered();
    check("Shop is there, as the level we are in", top[0]!.startsWith("Shop") && top[0]!.includes("you are inside it"), JSON.stringify(top));
    await page.keyboard.press("Enter"); // on Shop: opens it instead of connecting
    check("inside Shop: Wishlist, not Cart", JSON.stringify(await offered()) === '["Wishlist"]', JSON.stringify(await offered()));
    await page.keyboard.press("Enter");
    const made = (await readDiagram(page)).edges.at(-1)!;
    check("Item → Wishlist made", made.fromTitle === "Item" && made.toTitle === "Wishlist");
  });
});

test("the placeholder and the list appear on the side the line is pulled from", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("sides.json");
  writeFileSync(path, JSON.stringify(LIFTING));
  await openFileViaChooser(page, path);
  const sides = ["left", "right", "top", "bottom"] as const;
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name }).first();

  await test.step("the 'Connect to' list opens on that side of the drop point", async () => {
    for (const side of sides) {
      await node("Users").hover();
      const from = await center(handle(page, "Users", side));
      await drag(page, from, await center(node("Payments")));
      const list = page.locator("[data-side-requested]");
      await list.waitFor();
      check(`pulled from the ${side}: list on the ${side}`, (await list.getAttribute("data-side")) === side, String(await list.getAttribute("data-side")));
      await page.keyboard.press("Escape");
    }
  });

  await test.step("inside a box, the External box… placeholder appears on that side while dragging; connected ones stay", async () => {
    await enter(page, "Shop");
    const viewport = page.viewportSize()!;
    /** Each external box's rectangle relative to Wishlist, so panning the view does not count as moving. */
    const externals = async () => {
      const wish = (await node("Wishlist").boundingBox())!;
      const all = await page.locator("[data-external-box]").evaluateAll((els) =>
        els.map((e) => ({ title: e.querySelector("[data-box-title]")!.textContent!, rect: e.getBoundingClientRect().toJSON() as DOMRect })),
      );
      return { wish, all, of: (t: string) => all.find((e) => e.title === t)?.rect };
    };
    const relative = (r: DOMRect, wish: { x: number; y: number }) => ({ x: Math.round(r.x - wish.x), y: Math.round(r.y - wish.y) });
    const before = await externals();
    const resting = ["Ledger", "Fraud"].map((t) => JSON.stringify(relative(before.of(t)!, before.wish)));
    for (const side of sides) {
      await node("Wishlist").hover();
      const from = await center(handle(page, "Wishlist", side));
      let placed = false;
      let stayed = false;
      let visible = false;
      await drag(page, from, { x: from.x + (side === "right" ? 40 : side === "left" ? -40 : 0), y: from.y + (side === "bottom" ? 40 : side === "top" ? -40 : 0) }, {
        midway: async () => {
          await page.waitForTimeout(300); // let the placeholder pan into view
          const box = (await node("Wishlist").boundingBox())!;
          const cart = (await node("Cart").boundingBox())!;
          const own = { left: Math.min(box.x, cart.x), right: Math.max(box.x + box.width, cart.x + cart.width), top: Math.min(box.y, cart.y), bottom: Math.max(box.y + box.height, cart.y + cart.height) };
          const now = await externals();
          const targets = [(await page.locator("[data-external-placeholder]").boundingBox())!].map((b) => ({ left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height }));
          placed =
            now.all.length === 2 &&
            targets.every((r) =>
              (side === "left" ? r.right <= own.left : side === "right" ? r.left >= own.right : side === "top" ? r.bottom <= own.top : r.top >= own.bottom),
            );
          stayed = ["Ledger", "Fraud"].every((t, i) => JSON.stringify(relative(now.of(t)!, now.wish)) === resting[i]);
          visible = targets.every((r) => r.left >= 0 && r.right <= viewport.width && r.top >= 48 && r.bottom <= viewport.height);
        },
      });
      check(`pulled from the ${side}: the placeholder on the ${side}`, placed);
      check(`pulled from the ${side}: the connected ones did not move`, stayed);
      check(`pulled from the ${side}: the placeholder on screen`, visible);
    }
  });

  await test.step("after, the connected ones are still on the right", async () => {
    await page.waitForTimeout(200);
    const wishlist = (await node("Wishlist").boundingBox())!;
    const rects = await page.locator("[data-external-box]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    check("still on the right", rects.length === 2 && rects.every((l) => l > wishlist.x + wishlist.width), JSON.stringify(rects));
  });
});

test("external boxes can be moved, and stay where they are put", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const path = testInfo.outputPath("place.json");
  writeFileSync(path, JSON.stringify(LIFTING));
  await openFileViaChooser(page, path);
  await enter(page, "Shop");

  const ledger = page.locator("[data-external-box]").filter({ has: page.locator("[data-box-title]", { hasText: /^Ledger$/ }) });
  /** Where Ledger was put inside Shop, as saved with the diagram. */
  const spot = async () => (await readDiagram(page)).nodes.find((n) => n.id === "shop")!.externals?.ledger;
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3;

  let placed: { x: number; y: number } | undefined;
  await test.step("dragging it puts it there", async () => {
    check("it starts in the column, with no spot of its own", (await spot()) === undefined);
    // Towards the middle of the screen: near an edge the canvas would scroll along.
    const from = await center(ledger);
    const viewport = page.viewportSize()!;
    const to = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) };
    await drag(page, from, to);
    const now = await center(ledger);
    // React Flow starts a drag on the first move, so the box trails by one of drag()'s 20 steps.
    const step = { x: Math.abs(to.x - from.x) / 20 + 2, y: Math.abs(to.y - from.y) / 20 + 2 };
    check(
      "it is where it was dropped",
      Math.abs(now.x - to.x) <= step.x && Math.abs(now.y - to.y) <= step.y,
      JSON.stringify({ now, to }),
    );
    placed = await spot();
    check("the spot is saved with the diagram", placed !== undefined);
  });

  await test.step("it is an edit like any other: undo and redo, staying inside the box", async () => {
    await undo(page);
    check("undo puts it back in the column", (await spot()) === undefined);
    check("…without leaving the box", JSON.stringify(await crumbs(page)) === '["Root","Shop"]', JSON.stringify(await crumbs(page)));
    await redo(page);
    check("redo moves it again", JSON.stringify(await spot()) === JSON.stringify(placed));
  });

  await test.step("it stays there after saving and reloading", async () => {
    await page.keyboard.press("Control+s");
    await page.getByRole("button", { name: /^File: [^,]*$/ }).waitFor();
    await page.reload();
    await page.locator(".react-flow__pane").waitFor();
    await enter(page, "Shop");
    check("the same spot after reloading", JSON.stringify(await spot()) === JSON.stringify(placed), JSON.stringify(await spot()));
  });

  await test.step("while a line is dragged to another box, it stays where it was put", async () => {
    const wish = page.locator(".react-flow__node", { hasText: "Wishlist" }).first();
    // Relative to Wishlist, so the view panning to the placeholder does not count.
    const offset = async () => {
      const [l, w] = [await center(ledger), await center(wish)];
      return { x: l.x - w.x, y: l.y - w.y };
    };
    const restingAt = await offset();
    await wish.hover();
    const from = await center(handle(page, "Wishlist", "left"));
    let stayed = false;
    await drag(page, from, { x: from.x - 40, y: from.y }, {
      midway: async () => {
        await page.waitForTimeout(300);
        stayed = near(await offset(), restingAt);
      },
    });
    check("it did not move while dragging", stayed);
    await page.waitForTimeout(300);
    check("still where it was put", near(await offset(), restingAt), JSON.stringify(await offset()));
    check("its spot is unchanged", JSON.stringify(await spot()) === JSON.stringify(placed));
  });
});
