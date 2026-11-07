import { check, openApp, readDiagram, test } from "./helpers";

test("create, edit, move and delete boxes on one canvas", async ({ page }) => {
  await openApp(page);
  const sidebarOpen = () => page.getByRole("heading", { name: "Box" }).isVisible();
  check("empty hint shown", await page.getByText("This canvas is empty").isVisible());

  const node = page.locator(".react-flow__node").first();
  let box = { x: 0, y: 0, width: 0, height: 0 };

  await test.step("right-click creates a box at the cursor", async () => {
    await page.mouse.click(500, 350, { button: "right" });
    await page.getByRole("menuitem", { name: "New box" }).click();
    await node.waitFor();
    check("box rendered and visible", await node.isVisible());
    box = (await node.boundingBox())!;
    check(
      "box centred on cursor",
      Math.abs(box.x + box.width / 2 - 500) < 3 && Math.abs(box.y + box.height / 2 - 350) < 3,
      JSON.stringify(box),
    );
    check("sidebar open", await sidebarOpen());
    check(
      "name field focused with its text selected",
      await page
        .getByLabel("Name")
        .evaluate(
          (el: HTMLInputElement) =>
            el === document.activeElement && el.selectionEnd! - el.selectionStart! === el.value.length,
        ),
    );
  });

  await test.step("sidebar edits update the box, one undo step per field", async () => {
    await page.keyboard.type("Payments API");
    await page.keyboard.press("Enter");
    check("title shown on box", (await node.innerText()).includes("Payments API"));
    await page.getByLabel("Technology").fill("Node.js");
    await page.getByLabel("Description").fill("Takes card payments and talks to the bank.");
    await page.getByLabel("Name").focus(); // blur the description
    const { past } = await readDiagram(page);
    check("each field edit is one undo step", past === 4, `past=${past} (create, name, tech, desc)`);
    check("empty hint gone", !(await page.getByText("This canvas is empty").isVisible()));
  });

  await test.step("clicking empty canvas closes the sidebar", async () => {
    await page.mouse.click(1000, 700);
    check("pane click closes sidebar", !(await sidebarOpen()));
  });

  await test.step("dragging moves the box as one undo step", async () => {
    const position = async () => (await readDiagram(page)).nodes.find((n) => n.title === "Payments API")!.position;
    const before = await position();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 100; i++) await page.mouse.move(box.x + 40 + i * 2, box.y + 40 + i);
    await page.mouse.up();
    const after = await position();
    check(
      "drag moved box by ~200,100",
      Math.abs(after.x - before.x - 200) < 4 && Math.abs(after.y - before.y - 100) < 4,
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    );
    check("drag is one undo step", (await readDiagram(page)).past === 5);
    check("drag did not open sidebar", !(await sidebarOpen()));
  });

  await test.step("clicking a box opens its sidebar", async () => {
    await node.click();
    check("click box opens sidebar", (await page.getByLabel("Name").inputValue()) === "Payments API");
  });

  await test.step("an emptied name falls back to the default", async () => {
    await page.mouse.click(400, 650, { button: "right" });
    await page.getByRole("menuitem", { name: "New box" }).click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    check("empty name falls back to default", (await page.getByLabel("Name").inputValue()) === "New box");
  });

  await test.step("a box with nested boxes shows a count badge", async () => {
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const parent = Object.values(store.diagram.nodes).find((n) => n.title === "Payments API")!;
      store.addBox(parent.id, { x: 0, y: 0 });
      store.addBox(parent.id, { x: 300, y: 0 });
    });
    check("child count badge shows 2", (await node.locator("[title='2 nested boxes']").count()) === 1);
  });

  await test.step("delete asks first, then removes the box and its contents", async () => {
    await node.click();
    await page.getByRole("button", { name: "Delete box" }).click();
    check("confirm mentions nested boxes", await page.getByText("also deletes the 2 boxes nested inside it").isVisible());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const { nodes } = await readDiagram(page);
    check("delete removes box and its children", nodes.length === 2, `nodes=${nodes.length} (root + second box)`);
    check("sidebar closed after delete", !(await sidebarOpen()));
  });

  await test.step("right-clicking a box shows the box's menu, not the canvas's", async () => {
    await page.locator(".react-flow__node").first().click({ button: "right" });
    const items = await page.getByRole("menuitem").allInnerTexts();
    check(
      "box menu: Copy, Duplicate, Delete",
      ["Copy", "Duplicate", "Delete"].every((name) => items.some((t) => t.startsWith(name))) &&
        !items.some((t) => t.startsWith("New box")),
      items.join(" | "),
    );
    await page.keyboard.press("Escape");
  });
});
