import {
  check,
  createBox,
  crumbs,
  drag,
  drained,
  enter,
  goBack,
  nodeNamed,
  openApp,
  readDiagram,
  redo,
  test,
  undo,
} from "./helpers";

test("undo and redo take you to where the change happened", async ({ page }) => {
  await openApp(page);
  const at = async (...path: string[]) => JSON.stringify(await crumbs(page)) === JSON.stringify(path);
  /** Presses a shortcut and reports whether `name` starts pulsing (the pulse only lasts ~1s). */
  const pressAndSeePulse = async (keys: string, name: string) => {
    await page.keyboard.press(keys);
    const pulsed = await nodeNamed(page, name)
      .locator(".nb-highlight")
      .waitFor({ timeout: 1000 })
      .then(() => true, () => false);
    await drained(page);
    return pulsed;
  };

  await createBox(page, 400, 300, "Shop");
  await createBox(page, 950, 300, "Payments");
  await enter(page, "Payments");
  await createBox(page, 500, 400, "Ledger");
  await goBack(page);
  const shopAtRoot = (await nodeNamed(page, "Shop").boundingBox())!;

  await test.step("undoing a change made inside another box goes there", async () => {
    const pulsed = await pressAndSeePulse("Control+z", "New box"); // undoes the name "Ledger"
    check("undo takes you to the level of the change", await at("Root", "Payments"), JSON.stringify(await crumbs(page)));
    check("the change is undone there", await nodeNamed(page, "New box").isVisible());
    check("the changed box pulses", pulsed);
    await page.waitForTimeout(1400);
    check("the pulse goes away", (await page.locator(".nb-highlight").count()) === 0);
  });

  await test.step("going back out returns to the view you left", async () => {
    await goBack(page);
    const shop = (await nodeNamed(page, "Shop").boundingBox())!;
    check("Esc returns to the root view you left", Math.abs(shop.x - shopAtRoot.x) < 1 && Math.abs(shop.y - shopAtRoot.y) < 1);
    check("the pulse does not replay on return", (await page.locator(".nb-highlight").count()) === 0);
  });

  await test.step("creations are shown on the level that holds them", async () => {
    await undo(page); // creating Ledger
    check(
      "undoing a creation shows its level",
      (await at("Root", "Payments")) && (await page.locator(".react-flow__node").count()) === 0,
    );
    const pulsed = await pressAndSeePulse("Control+y", "New box");
    check("redo on the shown level stays put", await at("Root", "Payments"));
    check("the restored box pulses", pulsed);
    await redo(page);
    check("redo of the rename", await nodeNamed(page, "Ledger").isVisible());
  });

  await test.step("undo jumps across branches", async () => {
    await goBack(page);
    await enter(page, "Shop");
    await createBox(page, 600, 400, "Cart");
    await goBack(page);
    await enter(page, "Payments");
    await undo(page); // the name "Cart"
    check("undo jumps across branches to Shop", await at("Root", "Shop"), JSON.stringify(await crumbs(page)));
  });

  await test.step("undoing a delete shows the level that held the box", async () => {
    await undo(page); // creating Cart
    await goBack(page);
    await nodeNamed(page, "Payments").click();
    await page.getByRole("button", { name: "Delete box" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await enter(page, "Shop");
    const pulsed = await pressAndSeePulse("Control+z", "Payments");
    check("undoing a delete shows the level that held the box", await at("Root"));
    const { titles } = await readDiagram(page);
    check("the box and its contents are back", titles.join() === "Ledger,Payments,Shop", JSON.stringify(titles));
    check("the restored box pulses", pulsed);
  });

  await test.step("an off-screen change is brought into view", async () => {
    await page.waitForTimeout(1300);
    await drag(page, { x: 700, y: 700 }, { x: -500, y: -100 }); // pan the root canvas far away
    const away = (await nodeNamed(page, "Shop").boundingBox())!;
    check("(setup) Shop is off-screen", away.x + away.width < 0 || away.y + away.height < 48, JSON.stringify(away));
    await redo(page); // delete Payments again
    await undo(page); // and bring it back
    await page.waitForTimeout(400);
    const pay = (await nodeNamed(page, "Payments").boundingBox())!;
    check(
      "undo pans to a change that was off-screen",
      pay.x >= 0 && pay.y >= 48 && pay.x + pay.width <= 1400 && pay.y + pay.height <= 860,
      JSON.stringify(pay),
    );
  });

  await test.step("rapid presses are all applied", async () => {
    const before = (await readDiagram(page)).past;
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await drained(page);
    const after = (await readDiagram(page)).past;
    check("three quick Ctrl+Z presses undo three steps", after === before - 3, `${before} → ${after}`);
  });
});
