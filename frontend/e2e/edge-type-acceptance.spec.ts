// The acceptance criteria of docs/edge-type-specs.md §9, one test each, in order.
// Other specs cover the same features in more depth; this one is the checklist.

import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SCHEMA_VERSION, type DiagramFile, type FileEdge, type FileNode } from "../src/model/types";
import { edgeTypes } from "../src/registry/edgeTypes";
import {
  check,
  drained,
  enter,
  openApp,
  openFileViaChooser,
  readDiagram,
  saveViaDownload,
  test,
  useFileFallback,
} from "./helpers";

const box = (id: string, title: string, x: number, children: FileNode[] = []): FileNode => ({
  id,
  title,
  position: { x, y: 0 },
  children,
  edges: [],
});

/** API → DB with the given connection, plus an Outer > Inner box for lifting. */
function fileWith(edge: Partial<FileEdge>, schemaVersion = SCHEMA_VERSION): DiagramFile {
  return {
    schemaVersion,
    root: {
      ...box("root", "Root", 0, [box("api", "API", 0), box("db", "DB", 500), box("outer", "Outer", 1000, [box("inner", "Inner", 0)])]),
      edges: [{ id: "e", from: "api", to: "db", ...edge }],
    },
  };
}

async function load(page: Page, path: string, file: DiagramFile) {
  writeFileSync(path, JSON.stringify(file));
  await openFileViaChooser(page, path);
}

const line = (page: Page, id = "e") => page.locator(`.react-flow__edge[data-id="${id}"] path.nb-connection`);
const typeOf = async (page: Page) => (await readDiagram(page)).edges.find((e) => e.id === "e")?.typeId;
const field = (page: Page) => page.getByLabel("Type", { exact: true });

async function chooseType(page: Page, search: string, label: string) {
  await field(page).click();
  await page.getByPlaceholder("Search types…").fill(search);
  await page.getByRole("option").filter({ hasText: label }).first().click();
}

async function selectLine(page: Page) {
  await line(page).click({ force: true });
}

test.beforeEach(async ({ page }) => {
  await useFileFallback(page);
  await openApp(page);
});

test("§9.1 new lines are generic and look as before; switching type redraws at once", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("a.json"), fileWith({}));
  const cls = (await line(page).getAttribute("class"))!;
  check("generic: dashed and flowing", cls.includes("nb-stroke-dashed") && cls.includes("nb-flow-normal"));
  await selectLine(page);
  check("sidebar shows Connection", (await field(page).innerText()).includes("Connection"));
  for (const [search, label, id] of [
    ["calls", "Calls", "request"],
    ["replicates", "Replicates to", "replication"],
    ["consumes", "Consumes from", "subscribe"],
  ] as const) {
    await chooseType(page, search, label);
    const style = edgeTypes.get(id)!.style;
    const now = (await line(page).getAttribute("class"))!;
    check(`${id}: ${style.stroke} stroke at once`, now.includes(`nb-stroke-${style.stroke}`), now);
  }
});

test("§9.2 the picker is grouped, shows icons and line samples, and searches by name", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("b.json"), fileWith({}));
  await selectLine(page);
  await field(page).click();
  check("grouped", JSON.stringify(await page.locator("[cmdk-group-heading]").allInnerTexts()) === '["GENERAL","COMMUNICATION","DATA"]');
  check("icons", (await page.getByRole("option").locator("svg.lucide").count()) >= 10);
  check("line samples", (await page.locator("[data-line-preview]").count()) === 10);
  await page.getByPlaceholder("Search types…").fill("publishes");
  check("search by name", JSON.stringify(await page.getByRole("option").allInnerTexts()) === '["Publishes to"]', JSON.stringify(await page.getByRole("option").allInnerTexts()));
});

test("§9.3 types survive saving and opening", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("c.json"), fileWith({ typeId: "read-write", label: "orders" }));
  const saved = await saveViaDownload(page);
  check("saved with its type", saved.root.edges[0]?.typeId === "read-write");
  await load(page, testInfo.outputPath("c2.json"), saved);
  check("reopened with its type", (await typeOf(page)) === "read-write");
});

test("§9.4 old files open, with every line generic", async ({ page }, testInfo) => {
  for (const version of [1, 2, 3]) {
    await load(page, testInfo.outputPath(`v${version}.json`), fileWith({}, version));
    check(`format ${version} opens without an error`, !(await page.getByRole("alertdialog").isVisible()));
    check(`format ${version}: line is generic`, (await line(page).getAttribute("class"))!.includes("nb-type-generic"));
  }
});

test("§9.5 an unknown type opens, draws as generic, and is kept on save", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("e.json"), fileWith({ typeId: "quantum-link" }));
  check("opens without an error", !(await page.getByRole("alertdialog").isVisible()));
  check("drawn as generic", (await line(page).getAttribute("class"))!.includes("nb-type-generic"));
  await selectLine(page);
  const shown = await field(page).innerText();
  check("the picker shows the stored id as unknown", shown.includes("quantum-link") && shown.includes("unknown type"), shown);
  const saved = await saveViaDownload(page);
  check("kept as written", saved.root.edges[0]?.typeId === "quantum-link");
});

test("§9.6 changing type keeps the label", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("f.json"), fileWith({ label: "POST /orders" }));
  await selectLine(page);
  await chooseType(page, "calls", "Calls");
  await chooseType(page, "writes", "Writes to");
  const edge = (await readDiagram(page)).edges.find((e) => e.id === "e")!;
  check("label kept", edge.typeId === "write" && edge.label === "POST /orders");
});

test("§9.7 type changes undo and redo", async ({ page }, testInfo) => {
  await load(page, testInfo.outputPath("g.json"), fileWith({}));
  await selectLine(page);
  await chooseType(page, "calls", "Calls");
  await chooseType(page, "streams", "Streams to");
  await page.mouse.click(30, 820);
  await page.keyboard.press("Control+z");
  await drained(page);
  check("undo: previous type", (await typeOf(page)) === "request");
  await page.keyboard.press("Control+z");
  await drained(page);
  check("undo again: generic", (await typeOf(page)) === undefined);
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+y");
  await drained(page);
  check("redo both", (await typeOf(page)) === "stream");
});

test("§9.8 every type has its own line style; lifted and external lines keep theirs", async ({ page }, testInfo) => {
  const signatures = edgeTypes.types.map((t) => JSON.stringify(t.style));
  check("no two types share a style", new Set(signatures).size === signatures.length);
  const file = fileWith({});
  file.root.edges = [{ id: "deep", from: "api", to: "inner", typeId: "write" }];
  await load(page, testInfo.outputPath("h.json"), file);
  const lifted = page.locator('.react-flow__edge[data-id="deep"]');
  check("lifted: faded", (await lifted.getAttribute("class"))!.includes("nb-lifted"));
  check("lifted: still dotted", (await line(page, "deep").getAttribute("class"))!.includes("nb-stroke-dotted"));
  await enter(page, "Outer");
  check("to an external box: still dotted", (await line(page, "deep").getAttribute("class"))!.includes("nb-stroke-dotted"));
});

test("§9.9 a typed line without a label shows its icon and verb; with one, icon and label", async ({ page }, testInfo) => {
  const file = fileWith({ typeId: "publish" });
  file.root.edges.push({ id: "f", from: "db", to: "outer", typeId: "request", label: "GET /stock" });
  await load(page, testInfo.outputPath("i.json"), file);
  const labels = page.locator("[data-edge-label]");
  const publish = labels.filter({ hasText: "Publishes to" });
  check("verb shown", (await publish.count()) === 1);
  check("with the icon", (await publish.locator('svg[aria-label="Publishes to"]').count()) === 1);
  const own = labels.filter({ hasText: "GET /stock" });
  check("own label shown", (await own.count()) === 1 && (await own.locator("svg").count()) === 1);
  check("verb not shown when there is a label", (await labels.filter({ hasText: /^Calls$/ }).count()) === 0);
});
