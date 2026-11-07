import type { Page } from "@playwright/test";
import {
  check,
  clickBlank,
  createBox,
  crumbs,
  enter,
  goBack,
  nodeNamed,
  openApp,
  readDiagram,
  settled,
  test,
} from "./helpers";

const sidebarOpen = (page: Page) => page.getByRole("heading", { name: "Box" }).isVisible();
const sameCrumbs = async (page: Page, expected: string[]) => JSON.stringify(await crumbs(page)) === JSON.stringify(expected);

test("move into boxes and back out", async ({ page }) => {
  await openApp(page);
  await createBox(page, 500, 350, "Payments");
  await createBox(page, 900, 350, "Shop");
  const before = (await nodeNamed(page, "Payments").boundingBox())!;
  const pastBefore = (await readDiagram(page)).past;

  await test.step("double-clicking a box zooms into it", async () => {
    await nodeNamed(page, "Payments").dblclick();
    await page.waitForTimeout(90);
    check(
      "enter is animated",
      await page.evaluate(() => document.querySelector("[data-canvas-stage]")!.getAnimations().length > 0),
    );
    await settled(page);
    check("breadcrumb is Root › Payments", await sameCrumbs(page, ["Root", "Payments"]), JSON.stringify(await crumbs(page)));
    check("inner canvas is empty", (await page.locator(".react-flow__node").count()) === 0);
    check("empty hint names the box", await page.getByText("Nothing inside “Payments” yet").isVisible());
    check("sidebar closed after entering", !(await sidebarOpen(page)));
  });

  await test.step("boxes nest to any depth", async () => {
    await createBox(page, 400, 300, "Ledger");
    await createBox(page, 800, 500, "Gateway");
    await enter(page, "Ledger");
    await createBox(page, 600, 400, "Entries table");
    check("three levels deep", await sameCrumbs(page, ["Root", "Payments", "Ledger"]));
  });

  await test.step("Esc goes up; entering a level fits its boxes on screen", async () => {
    await goBack(page);
    check("Esc goes up one level", await sameCrumbs(page, ["Root", "Payments"]));
    check("Ledger badge shows 1", (await nodeNamed(page, "Ledger").locator("[title='1 nested box']").count()) === 1);

    await page.mouse.wheel(0, 3000); // zoom far out to disturb the view
    await page.waitForTimeout(200);
    await enter(page, "Ledger");
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const b = (await nodeNamed(page, "Entries table").boundingBox())!;
    check(
      "entering fits the children on screen",
      b.x >= pane.x && b.y >= pane.y && b.x + b.width <= pane.x + pane.width && b.y + b.height <= pane.y + pane.height,
    );
    await goBack(page);
  });

  await test.step("double-clicking the background goes up and restores the view", async () => {
    await page.mouse.dblclick(1200, 150);
    await settled(page);
    check("background double-click goes up", await sameCrumbs(page, ["Root"]));
    const after = (await nodeNamed(page, "Payments").boundingBox())!;
    check(
      "returning restores where you were",
      Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1,
      `${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
    );
    check("Payments badge shows 2", (await nodeNamed(page, "Payments").locator("[title='2 nested boxes']").count()) === 1);
    const { past } = await readDiagram(page);
    check("navigation adds no undo steps", past === pastBefore + 6, `past=${past}, expected ${pastBefore + 6} (3 boxes × create+name)`);
  });

  await test.step("at the root, Esc and background double-click stay put", async () => {
    await page.keyboard.press("Escape");
    await page.mouse.dblclick(1200, 150);
    await page.waitForTimeout(400);
    check("at root, Esc / double-click stay put", await sameCrumbs(page, ["Root"]));
  });

  await test.step("the sidebar does not stay open after a double-click", async () => {
    await enter(page, "Payments");
    check("no sidebar after double-click", !(await sidebarOpen(page)));
  });

  await test.step("Esc inside a text field only leaves the field", async () => {
    await nodeNamed(page, "Gateway").click();
    await page.getByLabel("Name").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("Esc in a field does not navigate", await sameCrumbs(page, ["Root", "Payments"]));
    check("…and the sidebar stays open", await sidebarOpen(page));
  });

  await test.step("the breadcrumb jumps several levels at once", async () => {
    await clickBlank(page);
    await enter(page, "Ledger");
    await page.getByRole("button", { name: "Root" }).click();
    await settled(page);
    check("breadcrumb jumps straight to Root", await sameCrumbs(page, ["Root"]));
  });

  await test.step("input during a transition is ignored", async () => {
    await nodeNamed(page, "Payments").dblclick();
    await page.keyboard.press("Escape"); // during the enter animation
    await settled(page);
    await page.waitForTimeout(100);
    await settled(page);
    check("input during a transition is ignored", await sameCrumbs(page, ["Root", "Payments"]), JSON.stringify(await crumbs(page)));
  });

  await test.step("deep paths collapse in the breadcrumb", async () => {
    await enter(page, "Ledger");
    for (const name of ["L3", "L4", "L5"]) {
      await createBox(page, 200, 760, name);
      await enter(page, name);
    }
    check(
      "deep breadcrumb collapses the middle",
      await sameCrumbs(page, ["Root", "…", "L3", "L4", "L5"]),
      JSON.stringify(await crumbs(page)),
    );
  });
});
