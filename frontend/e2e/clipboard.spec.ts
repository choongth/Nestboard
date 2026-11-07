import type { Page } from "@playwright/test";
import { check, clickBlank, createBox, enter, nodeNamed, openApp, readDiagram, test, undo } from "./helpers";

/** Titles of the selected boxes, sorted. */
const selected = (page: Page) =>
  page.evaluate(() => {
    const { selection } = window.__nestboard!.viewStore.getState();
    const { nodes } = window.__nestboard!.diagramStore.getState().diagram;
    return selection?.type === "boxes" ? selection.ids.map((id) => nodes[id]!.title).sort() : [];
  });

const count = async (page: Page, title: string) => (await readDiagram(page)).nodes.filter((n) => n.title === title).length;

/** Connections as "from→to" titles, sorted, with how many of each. */
const lines = async (page: Page) => (await readDiagram(page)).edges.map((e) => `${e.fromTitle}→${e.toTitle}`).sort();

test("copy, cut, paste and duplicate boxes", async ({ page }) => {
  await openApp(page);
  await createBox(page, 300, 250, "Alpha");
  await createBox(page, 650, 250, "Beta");
  await createBox(page, 1000, 600, "Gamma");
  // Alpha holds a box; Alpha → Beta stays inside the copy, Alpha → Gamma leaves it.
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const byTitle = (t: string) => Object.values(store.diagram.nodes).find((n) => n.title === t)!.id;
    const inner = store.addBox(byTitle("Alpha"), { x: 0, y: 0 });
    window.__nestboard!.diagramStore.getState().updateBox(inner, { title: "Inner" });
    window.__nestboard!.diagramStore.getState().addConnection(byTitle("Alpha"), byTitle("Beta"));
    window.__nestboard!.diagramStore.getState().addConnection(byTitle("Alpha"), byTitle("Gamma"));
  });

  await test.step("Ctrl+C then Ctrl+V pastes a copy at the pointer, with its contents and inner connections", async () => {
    await nodeNamed(page, "Alpha").click();
    await nodeNamed(page, "Beta").click({ modifiers: ["Shift"] });
    await page.keyboard.press("Control+c");
    const past = (await readDiagram(page)).past;
    check("copying changes nothing", past === (await readDiagram(page)).past && (await count(page, "Alpha")) === 1);

    await page.mouse.move(480, 620);
    await page.keyboard.press("Control+v");
    check("Alpha and Beta pasted", (await count(page, "Alpha")) === 2 && (await count(page, "Beta")) === 2);
    check("nested box copied too", (await count(page, "Inner")) === 2);
    const l = await lines(page);
    check(
      "connection between copied boxes copied; one leaving them not",
      l.filter((x) => x === "Alpha→Beta").length === 2 && l.filter((x) => x === "Alpha→Gamma").length === 1,
      l.join(", "),
    );
    check("pasted boxes are selected", JSON.stringify(await selected(page)) === '["Alpha","Beta"]');
    check("one undo step", (await readDiagram(page)).past === past + 1);

    // The pasted pair is centred on the pointer.
    const pasted = page.locator(".react-flow__node.selected");
    const boxes = await Promise.all([0, 1].map(async (i) => (await pasted.nth(i).boundingBox())!));
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    check(
      "centred on the pointer",
      Math.abs((left + right) / 2 - 480) < 4 && Math.abs((top + bottom) / 2 - 620) < 4,
      JSON.stringify({ left, right, top, bottom }),
    );
  });

  await test.step("pasting again in the same place steps aside", async () => {
    const before = (await readDiagram(page)).nodes.filter((n) => n.title === "Alpha").map((n) => n.position);
    await page.keyboard.press("Control+v");
    const after = (await readDiagram(page)).nodes.filter((n) => n.title === "Alpha").map((n) => n.position);
    const newest = after.find((p) => !before.some((b) => b.x === p.x && b.y === p.y))!;
    check("third copy", after.length === 3);
    check("24px further", before.some((b) => b.x + 24 === newest.x && b.y + 24 === newest.y), JSON.stringify(after));
    await undo(page);
    await undo(page);
    check("undo removes the pastes", (await count(page, "Alpha")) === 1);
  });

  await test.step("Ctrl+D duplicates next to the originals and leaves the clipboard alone", async () => {
    await nodeNamed(page, "Gamma").click();
    const gamma = (await readDiagram(page)).nodes.find((n) => n.title === "Gamma")!.position;
    await page.keyboard.press("Control+d");
    const copies = (await readDiagram(page)).nodes.filter((n) => n.title === "Gamma").map((n) => n.position);
    check("duplicated", copies.length === 2);
    check("24px off", copies.some((p) => p.x === gamma.x + 24 && p.y === gamma.y + 24), JSON.stringify(copies));
    check("the duplicate is selected", JSON.stringify(await selected(page)) === '["Gamma"]');
    await undo(page);
  });

  await test.step("Ctrl+X cuts; Ctrl+V pastes it on another level", async () => {
    await nodeNamed(page, "Beta").click();
    await page.keyboard.press("Control+x");
    check("Beta cut", (await count(page, "Beta")) === 0);
    check("its connection went with it", !(await lines(page)).includes("Alpha→Beta"));

    await enter(page, "Gamma");
    await page.mouse.move(600, 400);
    await page.keyboard.press("Control+v");
    const beta = (await readDiagram(page)).nodes.find((n) => n.title === "Beta");
    const gamma = (await readDiagram(page)).nodes.find((n) => n.title === "Gamma");
    check("pasted inside Gamma", beta?.parentId === gamma?.id);
    check("shown on this level", await nodeNamed(page, "Beta").isVisible());
    await page.keyboard.press("Escape"); // clear the selection
    await page.keyboard.press("Escape"); // back to the root
  });

  await test.step("right-click → Paste pastes what was copied, where you clicked", async () => {
    await nodeNamed(page, "Alpha").click();
    await page.keyboard.press("Control+c");
    await clickBlank(page);
    await page.mouse.click(700, 650, { button: "right" });
    await page.getByRole("menuitem", { name: /Paste/ }).click();
    check("pasted from the menu", (await count(page, "Alpha")) === 2);
    const box = (await page.locator(".react-flow__node.selected").boundingBox())!;
    check("centred where clicked", Math.abs(box.x + box.width / 2 - 700) < 4 && Math.abs(box.y + box.height / 2 - 650) < 4);
  });

  await test.step("text fields keep their own copy and paste; other text is not pasted as boxes", async () => {
    await nodeNamed(page, "Gamma").click();
    const name = page.getByLabel("Name");
    await name.focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    check("pasted as text in the field", (await name.inputValue()) === "GammaGamma");
    await page.keyboard.press("Enter");

    const total = (await readDiagram(page)).nodes.length;
    await clickBlank(page);
    await page.mouse.move(500, 500);
    await page.keyboard.press("Control+v");
    check("plain text on the clipboard adds nothing", (await readDiagram(page)).nodes.length === total);
  });
});

test("a box's right-click menu cuts, copies, duplicates and deletes", async ({ page }) => {
  await openApp(page);
  await createBox(page, 300, 250, "Alpha");
  await createBox(page, 650, 250, "Beta");
  await createBox(page, 450, 600, "Gamma");
  const menu = (name: string) => page.getByRole("menuitem", { name: new RegExp(`^${name}`) });

  await test.step("right-clicking a box outside the selection selects just it", async () => {
    await nodeNamed(page, "Alpha").click();
    await nodeNamed(page, "Beta").click({ button: "right" });
    check("Beta alone selected", JSON.stringify(await selected(page)) === '["Beta"]', String(await selected(page)));
    await menu("Duplicate").click();
    check("Duplicate copies it", (await count(page, "Beta")) === 2);
    await undo(page);
  });

  await test.step("Copy, then Paste in the canvas menu", async () => {
    await nodeNamed(page, "Gamma").click({ button: "right" });
    await menu("Copy").click();
    await page.mouse.click(900, 650, { button: "right" });
    await menu("Paste").click();
    check("pasted", (await count(page, "Gamma")) === 2);
    await undo(page);
  });

  await test.step("Cut removes the box in one undo step; Paste brings it back", async () => {
    const past = (await readDiagram(page)).past;
    await nodeNamed(page, "Gamma").click({ button: "right" });
    await menu("Cut").click();
    check("Gamma cut", (await count(page, "Gamma")) === 0);
    check("one undo step", (await readDiagram(page)).past === past + 1);
    check("nothing selected", (await selected(page)).length === 0);
    await page.mouse.click(700, 650, { button: "right" });
    await menu("Paste").click();
    check("pasted back", (await count(page, "Gamma")) === 1);
  });

  await test.step("right-clicking a selected box acts on the whole selection", async () => {
    await nodeNamed(page, "Alpha").click();
    await nodeNamed(page, "Beta").click({ modifiers: ["Shift"] });
    await nodeNamed(page, "Alpha").click({ button: "right" });
    check("selection kept", JSON.stringify(await selected(page)) === '["Alpha","Beta"]');
    await menu("Delete").click();
    check("asks first", await page.getByRole("alertdialog", { name: "Delete 2 boxes?" }).isVisible());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    check("both deleted", JSON.stringify((await readDiagram(page)).titles) === '["Gamma"]');
  });

  await test.step("one empty box is deleted straight away", async () => {
    await nodeNamed(page, "Gamma").click({ button: "right" });
    await menu("Delete").click();
    check("no dialog", (await page.getByRole("alertdialog").count()) === 0);
    check("deleted", (await readDiagram(page)).titles.length === 0);
  });
});
