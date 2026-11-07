import { center, check, clickBlank, createBox, drag, nodeNamed, openApp, readDiagram, test, undo } from "./helpers";
import type { Page } from "@playwright/test";

/** Titles of the selected boxes, sorted. */
const selected = (page: Page) =>
  page.evaluate(() => {
    const { selection } = window.__nestboard!.viewStore.getState();
    const { nodes } = window.__nestboard!.diagramStore.getState().diagram;
    return selection?.type === "boxes" ? selection.ids.map((id) => nodes[id]!.title).sort() : [];
  });

const position = async (page: Page, title: string) =>
  (await readDiagram(page)).nodes.find((n) => n.title === title)!.position;

test("select several boxes, move and delete them together", async ({ page }) => {
  await openApp(page);
  await createBox(page, 300, 250, "Alpha");
  await createBox(page, 650, 250, "Beta");
  await createBox(page, 300, 560, "Gamma");

  await test.step("Shift+click and Ctrl+click add and remove boxes", async () => {
    await nodeNamed(page, "Alpha").click();
    await nodeNamed(page, "Beta").click({ modifiers: ["Shift"] });
    check("Shift+click adds", JSON.stringify(await selected(page)) === '["Alpha","Beta"]', String(await selected(page)));
    await nodeNamed(page, "Gamma").click({ modifiers: ["Control"] });
    check("Ctrl+click adds", (await selected(page)).length === 3);
    await nodeNamed(page, "Alpha").click({ modifiers: ["Shift"] });
    check("Shift+click removes", JSON.stringify(await selected(page)) === '["Beta","Gamma"]', String(await selected(page)));
    check("sidebar lists the selection", await page.getByRole("heading", { name: "2 boxes" }).isVisible());
    check(
      "selected boxes show the white border",
      (await page.locator(".react-flow__node.selected").count()) === 2,
    );
    await nodeNamed(page, "Alpha").click();
    check("plain click selects just one", JSON.stringify(await selected(page)) === '["Alpha"]');
    check("one box shows the box panel", await page.getByLabel("Name").isVisible());
  });

  await test.step("Shift+drag on the background draws a selection rectangle", async () => {
    await clickBlank(page);
    await page.keyboard.down("Shift");
    await drag(page, { x: 120, y: 120 }, { x: 900, y: 380 });
    await page.keyboard.up("Shift");
    check("rectangle selects the boxes it touches", JSON.stringify(await selected(page)) === '["Alpha","Beta"]', String(await selected(page)));
  });

  await test.step("a plain drag on the background still pans", async () => {
    const before = await nodeNamed(page, "Gamma").boundingBox();
    await drag(page, { x: 800, y: 720 }, { x: 850, y: 740 });
    const after = await nodeNamed(page, "Gamma").boundingBox();
    check("panned", Math.abs(after!.x - before!.x - 50) < 3, `${before!.x} → ${after!.x}`);
    check("panning keeps the selection", (await selected(page)).length === 2);
  });

  await test.step("dragging a selected box moves the selection as one undo step", async () => {
    const past = (await readDiagram(page)).past;
    const alpha = await position(page, "Alpha");
    const beta = await position(page, "Beta");
    const gamma = await position(page, "Gamma");
    const from = await center(nodeNamed(page, "Alpha"));
    await drag(page, from, { x: from.x + 100, y: from.y + 40 }, { steps: 100 });
    const movedA = await position(page, "Alpha");
    const movedB = await position(page, "Beta");
    check("Alpha moved", Math.abs(movedA.x - alpha.x - 100) < 4 && Math.abs(movedA.y - alpha.y - 40) < 4, `${JSON.stringify(alpha)} → ${JSON.stringify(movedA)}`);
    check("Beta moved with it", Math.abs(movedB.x - beta.x - 100) < 4 && Math.abs(movedB.y - beta.y - 40) < 4);
    check("Gamma stayed", JSON.stringify(await position(page, "Gamma")) === JSON.stringify(gamma));
    check("one undo step", (await readDiagram(page)).past === past + 1);

    await undo(page);
    check("undo puts both back", JSON.stringify([await position(page, "Alpha"), await position(page, "Beta")]) === JSON.stringify([alpha, beta]));
  });

  await test.step("dragging an unselected box moves only that box", async () => {
    const alpha = await position(page, "Alpha");
    const gamma = await position(page, "Gamma");
    const from = await center(nodeNamed(page, "Gamma"));
    await drag(page, from, { x: from.x + 60, y: from.y }, { steps: 60 });
    check("Gamma moved", Math.abs((await position(page, "Gamma")).x - gamma.x - 60) < 4);
    check("Alpha stayed", JSON.stringify(await position(page, "Alpha")) === JSON.stringify(alpha));
    check("selection unchanged", JSON.stringify(await selected(page)) === '["Alpha","Beta"]');
  });

  await test.step("Esc clears the selection", async () => {
    await page.keyboard.press("Escape");
    check("nothing selected", (await selected(page)).length === 0);
  });

  await test.step("Ctrl+A selects every box on the level", async () => {
    await page.keyboard.press("Control+a");
    check("all three selected", (await selected(page)).length === 3);
  });

  await test.step("Delete asks before removing several boxes", async () => {
    await nodeNamed(page, "Alpha").click();
    await nodeNamed(page, "Beta").click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    check("asks first", await page.getByRole("alertdialog", { name: "Delete 2 boxes?" }).isVisible());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    check("both deleted", JSON.stringify((await readDiagram(page)).titles) === '["Gamma"]');
    check("sidebar closed", !(await page.locator("aside").isVisible()));

    await undo(page);
    check("one undo brings both back", (await readDiagram(page)).titles.length === 3);
  });

  await test.step("Backspace removes one empty box straight away", async () => {
    await nodeNamed(page, "Gamma").click();
    await page.keyboard.press("Backspace");
    check("no dialog", (await page.getByRole("alertdialog").count()) === 0);
    check("Gamma deleted", !(await readDiagram(page)).titles.includes("Gamma"));
  });

  await test.step("Delete inside the name field edits text, not the diagram", async () => {
    await nodeNamed(page, "Alpha").click();
    await page.getByLabel("Name").focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    check("box still there, name edited", (await readDiagram(page)).titles.includes("Alph"));
  });
});
