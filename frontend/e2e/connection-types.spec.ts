// Connection types: each line is drawn in its type's style (src/registry/edgeTypes.ts).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { SCHEMA_VERSION, type DiagramFile } from "../src/model/types";
import { edgeTypes } from "../src/registry/edgeTypes";
import { check, enter, openApp, openFileViaChooser, test, useFileFallback } from "./helpers";

// The examples folder sits at the repository root, next to frontend/.
const GALLERY = fileURLToPath(
  new URL("../../examples/connection-types-gallery.json", import.meta.url),
);
const markerFor = (end: string, selected = false) =>
  end === "none" ? null : `url(#nb-marker-${end}${selected ? "-selected" : ""})`;
const path = (edge: Locator) => edge.locator("path.nb-connection");

test("every connection type is drawn in its own style", async ({ page }) => {
  await useFileFallback(page);
  await openApp(page);
  await openFileViaChooser(page, GALLERY);

  await test.step("stroke, flow and arrowheads follow the type", async () => {
    for (const [i, type] of edgeTypes.types.entries()) {
      const line = path(page.locator(`.react-flow__edge[data-id="e${i}"]`));
      const cls = (await line.getAttribute("class"))!;
      const { stroke, flow, start, end } = type.style;
      check(`${type.id}: ${stroke} stroke`, cls.includes(`nb-stroke-${stroke}`), cls);
      const animation = await line.evaluate((el) => getComputedStyle(el).animationName);
      const expected = flow === "none" ? "none" : flow === "fast" ? "nb-dash-long" : "nb-dash";
      check(`${type.id}: flow ${flow}`, animation === expected, animation);
      check(`${type.id}: start ${start}`, (await line.getAttribute("marker-start")) === markerFor(start));
      check(`${type.id}: end ${end}`, (await line.getAttribute("marker-end")) === markerFor(end));
    }
  });

  await test.step("generic lines look exactly as before types existed", async () => {
    const generic = path(page.locator('.react-flow__edge[data-id="e0"]'));
    const dash = await generic.evaluate((el) => getComputedStyle(el).strokeDasharray);
    check("dashed 6/4", dash.replace(/px/g, "").replace(/,\s*/g, " ") === "6 4", dash);
    check("no label tag", (await page.locator('[data-edge-label]').filter({ hasText: "Connects to" }).count()) === 0);
  });

  await test.step("a typed line's label shows its icon and verb; the user's own label wins", async () => {
    const labels = page.locator("[data-edge-label]");
    for (const type of edgeTypes.types.filter((t) => t.id !== "generic" && t.id !== "request")) {
      const tag = labels.filter({ hasText: type.verb });
      check(`${type.id}: label shows "${type.verb}"`, (await tag.count()) === 1);
      check(`${type.id}: with its icon`, (await tag.locator(`svg[aria-label="${type.label}"]`).count()) === 1);
    }
    const request = labels.filter({ hasText: "POST /orders" });
    check("own label shown instead of the verb", (await request.count()) === 1 && (await labels.filter({ hasText: /^Calls$/ }).count()) === 0);
    check("…still with the type icon", (await request.locator("svg").count()) === 1);
  });

  await test.step("a double line has a core that stops short of its arrowhead", async () => {
    const core = page.locator('.react-flow__edge[data-id="e9"] path.nb-double-core');
    const dash = await core.evaluate((el) => getComputedStyle(el).strokeDasharray);
    check("core drawn", (await core.count()) === 1);
    check("core leaves the ends free", dash.startsWith("0px, 12px") || dash.startsWith("0, 12"), dash);
  });

  await test.step("selected lines switch to the selected arrowheads", async () => {
    await page.locator("[data-edge-label]").filter({ hasText: "Reads & writes" }).click();
    const line = path(page.locator('.react-flow__edge[data-id="e8"]'));
    check("selected start", (await line.getAttribute("marker-start")) === markerFor("arrow", true));
    check("selected end", (await line.getAttribute("marker-end")) === markerFor("arrow", true));
  });
});

test("a lifted line keeps its type's style, faded", async ({ page }, testInfo) => {
  await useFileFallback(page);
  await openApp(page);
  const box = (id: string, title: string, children: DiagramFile["root"][] = [], x = 0) => ({
    id,
    title,
    position: { x, y: 0 },
    children,
    edges: [],
  });
  const file: DiagramFile = {
    schemaVersion: SCHEMA_VERSION,
    root: {
      ...box("root", "Root", [box("api", "API", [box("handler", "Handler")]), box("db", "Database", [], 500)]),
      edges: [{ id: "reads", from: "handler", to: "db", typeId: "read" }],
    },
  };
  const path_ = testInfo.outputPath("lifted.json");
  writeFileSync(path_, JSON.stringify(file));
  await openFileViaChooser(page, path_);

  const edge = page.locator('.react-flow__edge[data-id="reads"]');
  check("drawn lifted (faded)", (await edge.getAttribute("class"))!.includes("nb-lifted"));
  check("still dotted", (await path(edge).getAttribute("class"))!.includes("nb-stroke-dotted"));
  check("still pointing back at the reader", (await path(edge).getAttribute("marker-start")) === markerFor("arrow"));

  await enter(page, "API");
  const inside = path(page.locator('.react-flow__edge[data-id="reads"]'));
  check("inside API, drawn to the external Database, same style", (await inside.getAttribute("class"))!.includes("nb-stroke-dotted"));
});

test("choosing a connection's type in the sidebar", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const root = store.diagram.rootId;
    const api = store.addBox(root, { x: 100, y: 250 });
    store.updateBox(api, { title: "Orders API" });
    const db = store.addBox(root, { x: 600, y: 250 });
    store.updateBox(db, { title: "Orders DB" });
    const edge = store.addConnection(api, db);
    store.setConnectionLabel(edge, "orders");
  });
  const typeOf = () =>
    page.evaluate(() => Object.values(window.__nestboard!.diagramStore.getState().diagram.edges)[0]!.typeId);
  const past = () => page.evaluate(() => window.__nestboard!.diagramStore.temporal.getState().pastStates.length);
  const field = page.getByLabel("Type", { exact: true });
  const line = page.locator("path.nb-connection").first();

  await page.locator("[data-edge-label]").click();
  check("a new connection shows Connection (generic)", (await field.innerText()).includes("Connection"));

  await field.click();
  const options = page.getByRole("option");
  check("all ten types offered", (await options.count()) === 10);
  check("each with a sample of its line", (await page.locator("[data-line-preview]").count()) === 10);
  check(
    "grouped General, Communication, Data",
    JSON.stringify(await page.locator("[cmdk-group-heading]").allInnerTexts()) === '["GENERAL","COMMUNICATION","DATA"]',
  );

  const before = await past();
  await page.getByPlaceholder("Search types…").fill("reads from");
  await page.keyboard.press("Enter");
  check("picked type is stored", (await typeOf()) === "read");
  check("as one undo step", (await past()) === before + 1);
  check("the line redraws dotted", (await line.getAttribute("class"))!.includes("nb-stroke-dotted"));
  check("the label is kept", (await page.getByLabel("Label").inputValue()) === "orders");

  await page.mouse.click(30, 820);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  check("undo restores generic", (await typeOf()) === undefined);
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(300);
  check("redo re-applies it", (await typeOf()) === "read");

  await page.locator("[data-edge-label]").click();
  const steps = await past();
  await field.click();
  await page.getByRole("option").filter({ hasText: "Reads from" }).click();
  check("picking the current type again changes nothing", (await past()) === steps);

  await field.click();
  await page.getByRole("option").filter({ hasText: "Connection" }).first().click();
  check("picking Connection clears the type", (await typeOf()) === undefined);
});
