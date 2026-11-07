import type { Locator } from "@playwright/test";
import {
  center,
  check,
  clickBlank,
  createBox,
  drag,
  drained,
  enter,
  goBack,
  handle,
  nodeNamed,
  openApp,
  readDiagram,
  settled,
  sidebarHeading,
  test,
} from "./helpers";

/** Screen position halfway along an SVG line. */
const midpoint = (path: Locator) =>
  path.evaluate((el: SVGPathElement) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    const ctm = el.getScreenCTM()!;
    return { x: p.x * ctm.a + ctm.e, y: p.y * ctm.d + ctm.f };
  });

test("draw, label, select and delete connections", async ({ page }) => {
  await openApp(page);
  await createBox(page, 400, 300, "Web app");
  await createBox(page, 950, 300, "API");
  await createBox(page, 400, 650, "Database");
  const opacity = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).opacity);
  const edgeCount = async () => (await readDiagram(page)).edges.length;

  await test.step("hovering a box shows its four connection points", async () => {
    await page.mouse.move(400, 300);
    await page.waitForTimeout(200);
    const shown = await Promise.all((["top", "right", "bottom", "left"] as const).map((s) => opacity(handle(page, "Web app", s))));
    check("hovering shows all four points", shown.every((o) => o === "1"), shown.join(","));
    check("other boxes keep their points hidden", (await opacity(handle(page, "API", "left"))) === "0");
  });

  await test.step("dragging point to point creates a labelled connection", async () => {
    const base = (await readDiagram(page)).past;
    await drag(page, await center(handle(page, "Web app", "right")), await center(handle(page, "API", "left")), {
      midway: async () => {
        check("while dragging, every box shows its points", (await opacity(handle(page, "Database", "top"))) === "1");
        check("a dashed preview line follows the cursor", (await page.locator(".react-flow__connection-path").count()) === 1);
      },
    });
    const { edges } = await readDiagram(page);
    check(
      "point-to-point drag creates a connection",
      edges.length === 1 && edges[0]!.fromTitle === "Web app" && edges[0]!.toTitle === "API",
      JSON.stringify(edges.map((e) => [e.fromTitle, e.toTitle])),
    );
    check("sidebar shows the new connection", (await sidebarHeading(page)) === "Connection");
    check("label field is focused", await page.getByLabel("Label").evaluate((el) => el === document.activeElement));
    await page.keyboard.type("Calls");
    await page.keyboard.press("Enter");
    check("label appears on the line", await page.locator(".react-flow__edgelabel-renderer").getByText("Calls").isVisible());
    check("connect + label = two undo steps", (await readDiagram(page)).past === base + 2);
  });

  await test.step("the line is dashed, flowing, with an arrowhead", async () => {
    const style = await page
      .locator(".react-flow__edge-path.nb-connection")
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { dash: cs.strokeDasharray, anim: cs.animationName, marker: el.getAttribute("marker-end") };
      });
    check("line is dashed", style.dash.replace(/px/g, "").replace(/,\s*/g, " ") === "6 4", style.dash);
    check("dashes flow", style.anim === "nb-dash", style.anim);
    check("line has an arrowhead", !!style.marker?.startsWith("url("), String(style.marker));
  });

  await test.step("dropping on a box's body connects to it", async () => {
    await page.mouse.move(400, 300);
    await drag(page, await center(handle(page, "Web app", "bottom")), { x: 430, y: 640 });
    const { edges } = await readDiagram(page);
    check("dropping on a box body connects to it", edges.some((e) => e.fromTitle === "Web app" && e.toTitle === "Database"));
  });

  await test.step("invalid drops connect nothing", async () => {
    await clickBlank(page);
    const count = await edgeCount();
    await page.mouse.move(950, 300);
    await drag(page, await center(handle(page, "API", "bottom")), { x: 1100, y: 700 });
    check("dropping on empty canvas connects nothing", (await edgeCount()) === count);
    await page.mouse.move(950, 300);
    await drag(page, await center(handle(page, "API", "top")), { x: 960, y: 310 });
    check("dropping back on the same box connects nothing", (await edgeCount()) === count);
  });

  const databaseLine = page.locator(".react-flow__edge").nth(1).locator("path.nb-connection");

  await test.step("lines re-route to the facing sides as boxes move", async () => {
    const startOf = async () =>
      (await databaseLine.getAttribute("d"))!
        .match(/^M\s*([-\d.]+)[ ,]([-\d.]+)/)!
        .slice(1)
        .map(Number);
    const [x1, y1] = await startOf();
    await drag(page, { x: 400, y: 650 }, { x: 1150, y: 420 }); // move Database clearly to the right of Web app
    await page.waitForTimeout(100);
    const [x2, y2] = await startOf();
    check("line re-routes when a box moves", x2! > x1! + 50 && y2! < y1!, `start ${x1},${y1} → ${x2},${y2}`);
  });

  await test.step("clicking a line or its label selects it", async () => {
    await clickBlank(page);
    await page.locator(".react-flow__edgelabel-renderer").getByText("Calls").click();
    check(
      "clicking a label selects its line",
      (await sidebarHeading(page)) === "Connection" && (await page.locator("aside").innerText()).includes("API"),
    );
    await clickBlank(page);
    const mid = await midpoint(databaseLine);
    await page.mouse.click(mid.x, mid.y);
    check("clicking a line selects it", (await page.locator("aside").innerText()).includes("Database"));
    check("selected line is highlighted", (await page.locator(".nb-connection-selected").count()) === 1);
    const stroke = await page.locator(".nb-connection-selected").evaluate((el) => getComputedStyle(el).stroke);
    check("selected line is brighter, not React Flow's grey", stroke === "rgb(168, 184, 255)", stroke);
  });

  await test.step("deleting a connection, and a box with one", async () => {
    await page.getByRole("button", { name: "Delete connection" }).click();
    check("delete connection removes it", (await edgeCount()) === 1 && (await sidebarHeading(page)) === null);
    await nodeNamed(page, "API").click();
    await page.getByRole("button", { name: "Delete box" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    check("deleting a box removes its connections", (await edgeCount()) === 0);
    check("no stray lines on screen", (await page.locator(".react-flow__edge").count()) === 0);
  });

  await test.step("each level has its own lines", async () => {
    await createBox(page, 950, 300, "API");
    await page.mouse.move(400, 300);
    await drag(page, await center(handle(page, "Web app", "right")), await center(handle(page, "API", "left")));
    await clickBlank(page);
    await enter(page, "API");
    check("inner level starts with no lines", (await page.locator(".react-flow__edge").count()) === 0);
    await createBox(page, 400, 400, "Router");
    await createBox(page, 900, 400, "Handlers");
    await page.mouse.move(400, 400);
    await drag(page, await center(handle(page, "Router", "right")), await center(handle(page, "Handlers", "left")));
    await clickBlank(page);
    check("inner level shows its own line", (await page.locator(".react-flow__edge").count()) === 1);

    const mid = await midpoint(page.locator("path.nb-connection"));
    await page.mouse.dblclick(mid.x, mid.y);
    await page.waitForTimeout(400);
    check(
      "double-clicking a line does not go up",
      (await page.locator("nav[aria-label=Breadcrumb]").innerText()).includes("API"),
    );

    await goBack(page);
    check("root shows only its own line", (await page.locator(".react-flow__edge").count()) === 1);
    const { edges } = await readDiagram(page);
    check("inner line is stored on the inner canvas", new Set(edges.map((e) => e.parentId)).size === 2);
  });
});

test("a dragged line starts at its connection point after moving between levels", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const outer = store.addBox(store.diagram.rootId, { x: 100, y: 100 });
    store.updateBox(outer, { title: "Outer Box 1" });
    const other = store.addBox(store.diagram.rootId, { x: 600, y: 100 });
    store.updateBox(other, { title: "Outer Box 2" });
    const inner = store.addBox(outer, { x: 0, y: 0 });
    store.updateBox(inner, { title: "Inner" });
  });

  /** How far (in canvas pixels) the line preview starts from the point it is dragged from. */
  async function previewOffset() {
    const box = nodeNamed(page, "Outer Box 1");
    await box.hover();
    const point = await center(handle(page, "Outer Box 1", "right"));
    let d = "";
    await drag(page, point, { x: point.x + 200, y: point.y + 200 }, {
      midway: async () => {
        d = (await page.locator(".react-flow__connection-path").getAttribute("d")) ?? "";
      },
    });
    await page.keyboard.press("Escape"); // close "Connect to…"
    const [x, y] = d.match(/^M\s*([-\d.]+)[ ,]([-\d.]+)/)!.slice(1).map(Number);
    const expected = await page.evaluate(([sx, sy]) => {
      const m = document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)!;
      const [tx, ty, zoom] = m.slice(1).map(Number) as [number, number, number];
      const r = document.querySelector(".react-flow")!.getBoundingClientRect();
      return [(sx - r.x - tx) / zoom, (sy - r.y - ty) / zoom];
    }, [point.x, point.y]);
    return Math.hypot(x! - expected[0]!, y! - expected[1]!);
  }

  check("before moving between levels", (await previewOffset()) < 1);
  await enter(page, "Outer Box 1");
  await goBack(page);
  const afterInOut = await previewOffset();
  check("after going in and back out", afterInOut < 1, `${afterInOut.toFixed(1)}px off`);

  await enter(page, "Outer Box 1");
  await page.getByRole("button", { name: "Root" }).click();
  await settled(page);
  const afterCrumb = await previewOffset();
  check("after a breadcrumb jump", afterCrumb < 1, `${afterCrumb.toFixed(1)}px off`);

  // Undo that switches level: rename the inner box from Root, undo goes inside, Esc comes back.
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const inner = Object.values(store.diagram.nodes).find((n) => n.title === "Inner")!;
    store.updateBox(inner.id, { title: "Inner renamed" });
  });
  await page.keyboard.press("Control+z");
  await drained(page);
  await goBack(page);
  const afterUndo = await previewOffset();
  check("after undo switched levels and back", afterUndo < 1, `${afterUndo.toFixed(1)}px off`);
});

test("the Connect to list closes on any click outside it, and still picks on click", async ({ page }) => {
  await openApp(page);
  await createBox(page, 400, 300, "Web app");
  await createBox(page, 950, 300, "API");
  // API holds a box, so dropping a line on API asks which one to connect to.
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const api = Object.values(store.diagram.nodes).find((n) => n.title === "API")!;
    const router = store.addBox(api.id, { x: 0, y: 0 });
    store.updateBox(router, { title: "Router" });
  });
  const list = page.getByPlaceholder("Search inside API…");
  async function openList() {
    await nodeNamed(page, "Web app").hover();
    await drag(page, await center(handle(page, "Web app", "right")), await center(nodeNamed(page, "API")));
    await list.waitFor();
  }

  await openList();
  await page.mouse.click(1200, 760);
  check("a left click on empty canvas closes it", !(await list.isVisible()));

  await openList();
  await nodeNamed(page, "Web app").click();
  check("clicking a box closes it", !(await list.isVisible()));

  await openList();
  const before = (await readDiagram(page)).edges.length;
  await page.getByRole("option").filter({ hasText: "Router" }).click();
  check("clicking an item in it still connects", (await readDiagram(page)).edges.length === before + 1 && !(await list.isVisible()));
});
