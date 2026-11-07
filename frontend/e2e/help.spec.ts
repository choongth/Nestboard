import type { Page } from "@playwright/test";
import { check, clickBlank, createBox, openApp, someoneElse, synced, test } from "./helpers";

const help = (page: Page) => page.getByRole("dialog", { name: "Help" });
const shortcut = (page: Page, action: string) => help(page).locator(`[data-shortcut="${action}"]`);

test("Help shows the shortcuts and a getting-started guide", async ({ page }) => {
  await openApp(page);
  await createBox(page, 500, 400, "Orders");
  await synced(page); // on the server, so the menu also offers Delete diagram

  await test.step("the File menu has Help, just above Delete diagram", async () => {
    await page.getByRole("button", { name: /^File:/ }).click();
    const items = (await page.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
    const at = items.findIndex((t) => t.startsWith("Help"));
    check("Help is in the menu", at >= 0, JSON.stringify(items));
    check("…right above Delete diagram", items[at + 1]?.startsWith("Delete diagram") === true, JSON.stringify(items));
    await page.getByRole("menuitem", { name: /^Help/ }).click();
    await help(page).waitFor();
  });

  await test.step("Shortcuts come first, grouped, with their keys", async () => {
    check("Shortcuts tab is open", (await help(page).getByRole("tab", { name: "Shortcuts" }).getAttribute("data-state")) === "active");
    for (const group of ["Moving around", "Selecting", "Editing", "Connecting", "Diagram"]) {
      check(`group ${group}`, await help(page).getByRole("heading", { name: group }).isVisible());
    }
    const keys = await shortcut(page, "Select every box on this level").locator("kbd").allInnerTexts();
    check("keys are drawn as keys", JSON.stringify(keys) === '["Ctrl","A"]', JSON.stringify(keys));
    const redo = await shortcut(page, "Redo").innerText();
    check("alternatives are joined with “or”", redo.includes("or"), redo);
    check("an editor sees no “Editors only” marks", (await help(page).getByText("Editors only").count()) === 0);
  });

  await test.step("Getting started is a list of cards", async () => {
    await help(page).getByRole("tab", { name: "Getting started" }).click();
    const cards = help(page).getByRole("listitem");
    check("five cards", (await cards.count()) === 5, String(await cards.count()));
    check("starting with boxes as canvases", (await cards.first().innerText()).includes("Every box is a canvas"));
    await help(page).getByRole("button", { name: "Close" }).click();
    check("Close closes it", !(await help(page).isVisible()));
  });

  await test.step("? opens it, Esc closes it, and the level stays", async () => {
    await clickBlank(page);
    await page.keyboard.press("?");
    await help(page).waitFor();
    check("? opens Help", await help(page).isVisible());
    await page.keyboard.press("Escape");
    check("Esc closes it", !(await help(page).isVisible()));
    check("…and the box is still on this level", await page.locator(".react-flow__node", { hasText: "Orders" }).isVisible());
  });

  await test.step("typing ? in a field just types it", async () => {
    await page.locator(".react-flow__node", { hasText: "Orders" }).click();
    const name = page.locator("aside").getByLabel("Name");
    await name.click();
    await name.press("End");
    await page.keyboard.type("?");
    check("no Help", !(await help(page).isVisible()));
    check("the ? is in the name", (await name.inputValue()) === "Orders?", await name.inputValue());
  });
});

test("a viewer's Help marks what needs edit rights", async ({ browser, request }) => {
  const viewer = await someoneElse(browser, request, "Vera Viewer", "viewer");
  try {
    await openApp(viewer.page);
    await viewer.page.keyboard.press("?");
    await help(viewer.page).waitFor();
    check("says they can only look", await help(viewer.page).getByText("You can look at this diagram but not change it").isVisible());
    const marked = (action: string) => shortcut(viewer.page, action).getByText("Editors only").count();
    check("New box is marked", (await marked("New box")) === 1);
    check("Copy is not (viewers can copy)", (await marked("Copy")) === 0);
    check("Zoom is not", (await marked("Zoom")) === 0);
  } finally {
    await viewer.close();
  }
});
