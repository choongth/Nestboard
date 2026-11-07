// The acceptance criteria of box-type-specs.md §10, one test each, in order.
// Other specs cover the same features in more depth; this one is the checklist.

import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SCHEMA_VERSION, type DiagramFile, type FileNode } from "../src/model/types";
import { boxTypes } from "../src/registry/boxTypes";
import { contrastRatio } from "../src/registry/technologyLogos";
import {
  check,
  clickBlank,
  drained,
  expect,
  nodeNamed,
  openApp,
  openFileViaChooser,
  readDiagram,
  saveViaDownload,
  test,
  useFileFallback,
} from "./helpers";

const box = (page: Page, title: string) => nodeNamed(page, title).locator("[data-box-type]");
const typeOf = async (page: Page, title: string) => (await readDiagram(page)).nodes.find((n) => n.title === title)?.typeId;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

async function newBox(page: Page, title: string, x = 500, y = 400) {
  await page.mouse.click(x, y, { button: "right" });
  await page.getByRole("menuitem", { name: "New box" }).click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

async function chooseType(page: Page, search: string, label: string) {
  await page.getByLabel("Type", { exact: true }).click();
  await page.getByPlaceholder("Search types…").fill(search);
  await page.getByRole("option").filter({ hasText: label }).first().click();
}

const fileNode = (id: string, title: string, extra: Partial<FileNode> = {}): FileNode => ({
  id,
  title,
  position: { x: 0, y: 0 },
  children: [],
  edges: [],
  ...extra,
});

function writeFile(path: string, schemaVersion: number, children: FileNode[]) {
  const file: DiagramFile = { schemaVersion, root: fileNode("root", "Root", { children }) };
  writeFileSync(path, JSON.stringify(file));
}

test.beforeEach(async ({ page }) => {
  await useFileFallback(page);
  await openApp(page);
});

test("§10.1 new boxes are generic; switching type redraws the box at once", async ({ page }) => {
  await newBox(page, "Edge");
  check("new box is generic", (await box(page, "Edge").getAttribute("data-box-type")) === "generic");
  check("sidebar shows Generic", (await page.getByLabel("Type", { exact: true }).innerText()).includes("Generic"));

  for (const [search, label, id] of [
    ["load bal", "Load Balancer", "load-balancer"],
    ["relational", "Relational Database", "relational-db"],
    ["queue", "Message Queue", "message-queue"],
  ] as const) {
    await chooseType(page, search, label);
    const type = boxTypes.get(id)!;
    const color = rgb(boxTypes.category(type.categoryId).color);
    const b = box(page, "Edge");
    check(`${id}: recognised immediately`, (await b.getAttribute("data-box-type")) === id);
    check(`${id}: icon changes`, (await b.locator("[data-box-icon] svg").getAttribute("class"))!.includes(`lucide-${type.icon}`));
    check(`${id}: colour changes`, (await b.locator("[data-box-icon]").evaluate((el) => getComputedStyle(el).color)) === color);
  }
});

test("§10.2 the type picker is grouped by category and searchable by name", async ({ page }) => {
  await newBox(page, "Edge");
  await page.getByLabel("Type", { exact: true }).click();
  const headings = await page.locator("[cmdk-group-heading]").allInnerTexts();
  check("grouped by category, in order", JSON.stringify(headings) === JSON.stringify(boxTypes.categories.map((c) => c.label.toUpperCase())));
  await page.getByPlaceholder("Search types…").fill("search engine");
  const found = await page.getByRole("option").allInnerTexts();
  check("search by name finds the type", found.length >= 1 && found[0]!.includes("Search Engine"), JSON.stringify(found));
});

test("§10.3 types survive saving and opening", async ({ page }, testInfo) => {
  await newBox(page, "Edge", 400, 300);
  await chooseType(page, "load bal", "Load Balancer");
  await clickBlank(page);
  await newBox(page, "Orders DB", 800, 300);
  await chooseType(page, "relational", "Relational Database");
  await clickBlank(page);
  await newBox(page, "Plain", 600, 600);
  await clickBlank(page);

  const saved = await saveViaDownload(page);
  const path = testInfo.outputPath("saved.json");
  writeFileSync(path, JSON.stringify(saved));
  await page.getByRole("button", { name: /^File:/ }).click();
  // The diagram saved itself as it was made: nothing to ask about.
  await page.getByRole("menuitem", { name: "New diagram" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  check("(starts from an empty diagram)", (await readDiagram(page)).titles.length === 0);

  await openFileViaChooser(page, path);
  check("load balancer kept", (await typeOf(page, "Edge")) === "load-balancer");
  check("database kept", (await typeOf(page, "Orders DB")) === "relational-db");
  check("generic stays generic", (await typeOf(page, "Plain")) === undefined);
  check("…and is drawn with its type", (await box(page, "Edge").getAttribute("data-box-type")) === "load-balancer");
});

test("§10.4 old files without types open, with every box generic", async ({ page }, testInfo) => {
  const path = testInfo.outputPath("v1.json");
  writeFile(path, 1, [fileNode("a", "Old A"), fileNode("b", "Old B", { children: [fileNode("c", "Old C")] })]);
  await openFileViaChooser(page, path);
  check("opens without an error", !(await page.getByRole("alertdialog").isVisible()));
  check("boxes are there", (await readDiagram(page)).titles.join() === "Old A,Old B,Old C");
  check("every box is generic", (await page.locator("[data-box-type]").evaluateAll((els) => els.every((e) => e.getAttribute("data-box-type") === "generic"))));
  const resaved = await saveViaDownload(page);
  check("saving upgrades it to the current format", resaved.schemaVersion === SCHEMA_VERSION);
});

test("§10.5 an unknown type opens, shows its id, and is kept on save", async ({ page }, testInfo) => {
  const path = testInfo.outputPath("unknown.json");
  writeFile(path, 2, [fileNode("q", "Mystery", { typeId: "quantum-router" }), fileNode("c", "Hot cache", { typeId: "cache" })]);
  await openFileViaChooser(page, path);
  check("opens without an error", !(await page.getByRole("alertdialog").isVisible()));
  const odd = box(page, "Mystery");
  check("drawn in the generic style", (await odd.getAttribute("data-box-type")) === "unknown");
  check("label shows the stored id", (await odd.locator("[data-box-label-text]").innerText()) === "quantum-router");
  const resaved = await saveViaDownload(page);
  check("the unknown id is saved unchanged", resaved.root.children.find((c) => c.title === "Mystery")?.typeId === "quantum-router");
});

test("§10.6 changing type clears the technology, as one undo step", async ({ page }) => {
  await newBox(page, "Edge");
  const techOfEdge = async () => (await readDiagram(page)).nodes.find((n) => n.title === "Edge")?.technology;
  const setNginx = async () => {
    await page.getByLabel("Technology", { exact: true }).fill("Nginx");
    await page.keyboard.press("Enter");
    check("(technology set)", (await techOfEdge()) === "Nginx");
  };
  // Reverse Proxy lists Nginx too, and Generic takes any text: it is cleared all the same.
  for (const [from, to] of [
    [["load bal", "Load Balancer"], ["reverse", "Reverse Proxy"]],
    [["reverse", "Reverse Proxy"], ["generic", "Generic"]],
  ] as const) {
    await chooseType(page, from[0], from[1]);
    await setNginx();
    const past = (await readDiagram(page)).past;
    await chooseType(page, to[0], to[1]);
    check(`cleared after switching to ${to[1]}`, (await techOfEdge()) === undefined, String(await techOfEdge()));
    check(`…in the same undo step as the type (${to[1]})`, (await readDiagram(page)).past === past + 1);
    check(`the field is empty (${to[1]})`, (await page.getByLabel("Technology", { exact: true }).inputValue()) === "");
  }
  await clickBlank(page);
  await page.keyboard.press("Control+z");
  await drained(page);
  check("one undo brings back both the type and the technology", (await typeOf(page, "Edge")) === "reverse-proxy" && (await techOfEdge()) === "Nginx");
});

test("§10.7 type changes undo and redo", async ({ page }) => {
  await newBox(page, "Edge");
  await chooseType(page, "load bal", "Load Balancer");
  await chooseType(page, "cache", "Cache");
  await clickBlank(page);
  await page.keyboard.press("Control+z");
  await drained(page);
  check("undo restores the previous type", (await typeOf(page, "Edge")) === "load-balancer");
  await page.keyboard.press("Control+z");
  await drained(page);
  check("undo again restores generic", (await typeOf(page, "Edge")) === undefined);
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+y");
  await drained(page);
  check("redo re-applies both", (await typeOf(page, "Edge")) === "cache");
});

test("§10.8 on the dark theme, category colours are distinct and every type has its own icon", async ({ page }) => {
  // One box of every type, read back from the screen.
  await page.evaluate((ids) => {
    const store = window.__nestboard!.diagramStore.getState();
    ids.forEach((typeId, i) => {
      const id = store.addBox(store.diagram.rootId, { x: (i % 6) * 300, y: Math.floor(i / 6) * 200 });
      store.updateBox(id, { title: `T-${typeId}`, typeId });
    });
  }, boxTypes.types.filter((t) => t.id !== "generic").map((t) => t.id));
  await page.waitForTimeout(300);

  const drawn = await page.locator("[data-box-type]").evaluateAll((els) =>
    els.map((el) => ({
      type: el.getAttribute("data-box-type"),
      icon: el.querySelector("[data-box-icon] svg")?.getAttribute("class"),
      color: el.querySelector<HTMLElement>("[data-box-label-text]") && getComputedStyle(el.querySelector("[data-box-label-text]")!).color,
    })),
  );
  check("every type is drawn", drawn.length === boxTypes.types.length - 1);
  check("every type has a different icon", new Set(drawn.map((d) => d.icon)).size === drawn.length);

  const byCategory = new Map<string, string>();
  for (const d of drawn) byCategory.set(boxTypes.get(d.type!)!.categoryId, d.color!);
  check("each category draws in its own colour", new Set(byCategory.values()).size === byCategory.size);

  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const hex = (c: string) => "#" + c.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  for (const [category, color] of byCategory) {
    const ratio = contrastRatio(hex(color), hex(canvas));
    check(`${category} reads clearly on the dark canvas`, ratio >= 4.5, ratio.toFixed(2));
  }
});
