import {
  center,
  check,
  clickBlank,
  createBox,
  crumbs,
  drag,
  drained,
  enter,
  goBack,
  handle,
  nodeNamed,
  openApp,
  readDiagram,
  redo,
  sidebarHeading,
  sidebarOpen,
  test,
  undo,
} from "./helpers";

test("undo and redo with shortcuts and buttons", async ({ page }) => {
  await openApp(page);
  const undoButton = page.getByRole("button", { name: "Undo" });
  const redoButton = page.getByRole("button", { name: "Redo" });
  const titles = async () => (await readDiagram(page)).titles;
  const inside = async (name: string) => (await crumbs(page)).includes(name);

  check("buttons start disabled", (await undoButton.isDisabled()) && (await redoButton.isDisabled()));
  await createBox(page, 400, 300, "Web app");
  await createBox(page, 950, 300, "API");
  check("Undo enables after an edit", await undoButton.isEnabled());

  await test.step("moves undo and redo, with both redo shortcuts", async () => {
    const position = async () => JSON.stringify((await readDiagram(page)).nodes.find((n) => n.title === "Web app")!.position);
    const p0 = await position();
    await drag(page, { x: 400, y: 300 }, { x: 500, y: 450 });
    const p1 = await position();
    await undo(page);
    check("Ctrl+Z undoes a move", (await position()) === p0);
    check("…and the box is drawn back in place", Math.abs((await nodeNamed(page, "Web app").boundingBox())!.x - 280) < 1);
    await redo(page);
    check("Ctrl+Y redoes it", (await position()) === p1);
    await undo(page);
    await page.keyboard.press("Control+Shift+z");
    await drained(page);
    check("Ctrl+Shift+Z also redoes", (await position()) === p1);
  });

  await test.step("a whole rename is one step", async () => {
    await nodeNamed(page, "API").click();
    await page.getByLabel("Name").fill("");
    await page.getByLabel("Name").pressSequentially("Backend API");
    await page.keyboard.press("Enter");
    await clickBlank(page);
    await undo(page);
    check("one Ctrl+Z reverts a whole rename", (await titles()).includes("API"), JSON.stringify(await titles()));
    await redo(page);
  });

  await test.step("inside a text field, Ctrl+Z stays with the field", async () => {
    await nodeNamed(page, "Backend API").click();
    await page.getByLabel("Name").click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    const count = (await titles()).length;
    await undo(page);
    check("Ctrl+Z inside a field does not undo diagram edits", (await titles()).length === count && (await sidebarOpen(page)));
    await page.keyboard.press("Escape");
    await clickBlank(page);
  });

  await test.step("undoing a selected connection closes the sidebar", async () => {
    await page.mouse.move(400, 300);
    await drag(page, await center(handle(page, "Web app", "right")), await center(handle(page, "Backend API", "left")));
    check("new connection is selected", (await sidebarHeading(page)) === "Connection");
    await page.keyboard.press("Escape"); // leave the label field
    await undo(page);
    check(
      "undoing a selected connection removes it and closes the sidebar",
      (await readDiagram(page)).edges.length === 0 && !(await sidebarOpen(page)),
    );
    await redo(page);
    check("redo brings the connection back", (await page.locator(".react-flow__edge").count()) === 1);
  });

  await test.step("one undo restores a deleted box with its contents and lines", async () => {
    await enter(page, "Backend API");
    await createBox(page, 500, 400, "Router");
    await goBack(page);
    await nodeNamed(page, "Backend API").click();
    await page.getByRole("button", { name: "Delete box" }).click();
    await undo(page); // ignored: the confirm dialog is open
    check("Ctrl+Z is ignored while a dialog is open", (await titles()).includes("Router"));
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const deleted = await readDiagram(page);
    check("delete removed box, child and connection", deleted.titles.join() === "Web app" && deleted.edges.length === 0);
    await undo(page);
    const restored = await readDiagram(page);
    check(
      "one Ctrl+Z restores box, nested box and connection",
      restored.titles.join() === "Backend API,Router,Web app" && restored.edges.length === 1,
      JSON.stringify(restored.titles),
    );
    check(
      "…and its badge and line are back on screen",
      (await nodeNamed(page, "Backend API").locator("[title='1 nested box']").count()) === 1 &&
        (await page.locator(".react-flow__edge").count()) === 1,
    );
  });

  await test.step("navigation is not undone; undo can take you out of a box that vanishes", async () => {
    await enter(page, "Backend API");
    await createBox(page, 900, 600, "Cache");
    check("inside Backend API", await inside("Backend API"));
    await undo(page); // name
    await undo(page); // create
    check(
      "navigation took no undo steps (Cache undone, still inside)",
      (await inside("Backend API")) && !(await titles()).includes("Cache"),
    );
    await goBack(page);

    await createBox(page, 650, 650, "Temp");
    await enter(page, "Temp");
    check("inside Temp", await inside("Temp"));
    await undo(page); // name
    await undo(page); // create: Temp is gone
    check("undoing the box you are in moves you to its parent", JSON.stringify(await crumbs(page)) === '["Root"]');
    await redo(page);
    await redo(page);
    check(
      "redo restores the box without dropping you back in",
      !(await inside("Temp")) && (await titles()).includes("Temp"),
      JSON.stringify(await crumbs(page)),
    );
  });

  await test.step("the Undo and Redo buttons", async () => {
    await undoButton.hover();
    const tip = page.getByRole("tooltip");
    await tip.waitFor({ timeout: 2000 }).catch(() => {});
    const tipText = (await tip.textContent().catch(() => "")) ?? "";
    check("Undo tooltip shows the shortcut", tipText.includes("Ctrl+Z"), tipText);
    const past = (await readDiagram(page)).past;
    await undoButton.click();
    await drained(page);
    check("Undo button undoes one step", (await readDiagram(page)).past === past - 1);
    await redoButton.click();
    await drained(page);
    check("Redo button redoes it", (await readDiagram(page)).past === past);
  });

  await test.step("undo everything, then redo everything", async () => {
    for (let i = 0; i < 60; i++) await page.keyboard.press("Control+z");
    await drained(page);
    check("everything undone back to an empty canvas", (await titles()).length === 0 && (await undoButton.isDisabled()));
    check("empty hint is back", await page.getByText("This canvas is empty").isVisible());
    for (let i = 0; i < 60; i++) await page.keyboard.press("Control+y");
    await drained(page);
    check(
      "redo all the way restores the final diagram",
      (await titles()).join() === "Backend API,Router,Temp,Web app" && (await redoButton.isDisabled()),
      JSON.stringify(await titles()),
    );
  });
});
