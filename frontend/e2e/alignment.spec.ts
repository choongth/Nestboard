import type { Page } from "@playwright/test";
import { center, check, createBox, nodeNamed, openApp, readDiagram, test, undo } from "./helpers";

const position = async (page: Page, title: string) =>
  (await readDiagram(page)).nodes.find((n) => n.title === title)!.position;

/**
 * Drags by exactly (dx, dy). React Flow starts a drag once the pointer has
 * moved more than 1px and counts movement from there, so a 2px nudge starts
 * it and the move is measured from the nudge. `midway` runs before release.
 */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number, midway?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const start = { x: from.x + 2, y: from.y };
  await page.mouse.move(start.x, start.y);
  const steps = 60;
  for (let i = 1; i <= steps; i++) await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps);
  await midway?.();
  await page.mouse.up();
}

const guides = (page: Page) => page.locator("[data-alignment-guides] line");

test("dragged boxes snap into line with others, with guides", async ({ page }) => {
  await openApp(page);
  await createBox(page, 300, 250, "Alpha");
  await createBox(page, 800, 600, "Beta");

  await test.step("a box dragged near another's centre line snaps onto it, showing a guide", async () => {
    const alpha = await position(page, "Alpha");
    const beta = await position(page, "Beta");
    const past = (await readDiagram(page)).past;
    // Lands 3px right of Alpha's line: within reach.
    let shown = 0;
    let axis: string | null = null;
    await dragBy(page, await center(nodeNamed(page, "Beta")), alpha.x - beta.x + 3, 0, async () => {
      shown = await guides(page).count();
      axis = shown > 0 ? await guides(page).first().getAttribute("data-guide") : null;
    });
    check("one guide while dragging", shown === 1, `guides=${shown}`);
    check("a vertical guide", axis === "x");
    check("snapped into line", (await position(page, "Beta")).x === alpha.x, JSON.stringify([alpha, await position(page, "Beta")]));
    check("guides gone after the drag", (await guides(page).count()) === 0);
    check("still one undo step", (await readDiagram(page)).past === past + 1);
  });

  await test.step("holding Alt drags freely, without snapping", async () => {
    const alpha = await position(page, "Alpha");
    let shown = -1;
    // Beta sits on Alpha's line; a drag that ends 4px off it stays off it.
    await page.keyboard.down("Alt");
    await dragBy(page, await center(nodeNamed(page, "Beta")), 4, 0, async () => {
      shown = await guides(page).count();
    });
    await page.keyboard.up("Alt");
    const beta = await position(page, "Beta");
    check("no guide with Alt", shown === 0, `guides=${shown}`);
    check("not snapped", Math.abs(beta.x - alpha.x) >= 2, JSON.stringify([alpha, beta]));
  });

  await test.step("far from any line, a drag goes exactly where it is pulled", async () => {
    const before = await position(page, "Beta");
    let shown = -1;
    await dragBy(page, await center(nodeNamed(page, "Beta")), 150, -40, async () => {
      shown = await guides(page).count();
    });
    const after = await position(page, "Beta");
    check("no guide", shown === 0, `guides=${shown}`);
    check("moved as pulled", Math.abs(after.x - before.x - 150) <= 1 && Math.abs(after.y - before.y + 40) <= 1);
    await undo(page);
  });
});

test("a dragged box snaps to the spacing of the boxes in its row", async ({ page }) => {
  await openApp(page);
  await createBox(page, 250, 250, "Alpha");
  await createBox(page, 620, 250, "Beta");
  await createBox(page, 800, 650, "Gamma");
  const alpha = await position(page, "Alpha");
  const beta = await position(page, "Beta");
  const gamma = await position(page, "Gamma");
  const gap = beta.x - (alpha.x + 240);

  // Lands 3px further than the Alpha–Beta gap to the right of Beta, in their row.
  let marked = 0;
  await dragBy(page, await center(nodeNamed(page, "Gamma")), beta.x + 240 + gap + 3 - gamma.x, beta.y + 20 - gamma.y, async () => {
    marked = await page.locator("[data-alignment-guides] [data-gap='x']").count();
  });
  const after = await position(page, "Gamma");
  check("both equal gaps marked while dragging", marked === 2, `markers=${marked}`);
  check("snapped to the same gap", after.x === beta.x + 240 + gap, JSON.stringify({ alpha, beta, after, gap }));
});

test("align and distribute several boxes from the sidebar", async ({ page }) => {
  await openApp(page);
  await createBox(page, 250, 200, "Alpha");
  await createBox(page, 520, 330, "Beta");
  await createBox(page, 950, 260, "Gamma");
  const titles = ["Alpha", "Beta", "Gamma"];
  const positions = async () => Promise.all(titles.map((t) => position(page, t)));

  await nodeNamed(page, "Alpha").click();
  await nodeNamed(page, "Beta").click({ modifiers: ["Shift"] });
  check(
    "distribute needs three boxes",
    await page.getByRole("button", { name: /^Distribute horizontally/ }).isDisabled(),
  );
  await nodeNamed(page, "Gamma").click({ modifiers: ["Shift"] });

  await test.step("align top lines them up on the highest box, as one undo step", async () => {
    const before = await positions();
    const past = (await readDiagram(page)).past;
    await page.getByRole("button", { name: "Align top" }).click();
    const after = await positions();
    const top = Math.min(...before.map((p) => p.y));
    check("same y", after.every((p) => p.y === top), JSON.stringify(after));
    check("x unchanged", after.every((p, i) => p.x === before[i]!.x));
    check("one undo step", (await readDiagram(page)).past === past + 1);
    check("selection kept", (await page.locator(".react-flow__node.selected").count()) === 3);
  });

  await test.step("distribute horizontally spaces the middle box evenly", async () => {
    await page.getByRole("button", { name: "Distribute horizontally" }).click();
    const [a, b, c] = await positions();
    check("equal gaps", Math.abs(b!.x - a!.x - (c!.x - b!.x)) <= 1, JSON.stringify([a, b, c]));
  });

  await test.step("align horizontal centres stacks them, and undo puts them back", async () => {
    const before = await positions();
    await page.getByRole("button", { name: "Align horizontal centres" }).click();
    const after = await positions();
    check("same x", new Set(after.map((p) => p.x)).size === 1, JSON.stringify(after));
    await undo(page);
    check("undo restores", JSON.stringify(await positions()) === JSON.stringify(before));
  });
});
