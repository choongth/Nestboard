import type { Page } from "@playwright/test";
import { boxTypes } from "../src/registry/boxTypes";
import { check, clickBlank, crumbs, drained, enter, nodeNamed, openApp, readDiagram, test } from "./helpers";

const trigger = (page: Page) => page.getByRole("combobox", { name: "Type" }).or(page.getByLabel("Type", { exact: true }));
const picker = (page: Page) => page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search types…") });
const options = (page: Page) => picker(page).getByRole("option");
const boxLabel = (page: Page, title: string) => nodeNamed(page, title).locator("[data-box-label]");
const typeOf = async (page: Page, title: string) =>
  (await readDiagram(page)).nodes.find((n) => n.title === title)?.typeId;

async function pick(page: Page, search: string, optionLabel: string) {
  await trigger(page).click();
  await page.getByPlaceholder("Search types…").fill(search);
  await options(page).filter({ hasText: optionLabel }).first().click();
}

test("choosing a box's type in the sidebar", async ({ page }) => {
  await openApp(page);
  await page.mouse.click(500, 400, { button: "right" });
  await page.getByRole("menuitem", { name: "New box" }).click();
  await page.keyboard.type("Edge");
  await page.keyboard.press("Enter");

  await test.step("the Type field sits between Name and Technology, showing Generic", async () => {
    const labels = await page.locator("aside label").allInnerTexts();
    check("field order: Name, Type, Technology, Description", JSON.stringify(labels) === '["Name","Type","Technology","Description"]', JSON.stringify(labels));
    check("a new box shows Generic", (await trigger(page).innerText()).includes("Generic"));
  });

  await test.step("the list is grouped by category, with every type and an icon each", async () => {
    await trigger(page).click();
    const headings = await picker(page).locator("[cmdk-group-heading]").allInnerTexts();
    const expected = boxTypes.categories.map((c) => c.label.toUpperCase());
    check("categories in order", JSON.stringify(headings) === JSON.stringify(expected), JSON.stringify(headings));
    check(`all ${boxTypes.types.length} types listed`, (await options(page).count()) === boxTypes.types.length);
    check("every option has an icon", (await options(page).locator("svg.lucide").count()) >= boxTypes.types.length);
    check("the current type is ticked", (await picker(page).getByLabel("Current type").count()) === 1);
    await page.keyboard.press("Escape");
  });

  await test.step("search by name", async () => {
    await trigger(page).click();
    await page.getByPlaceholder("Search types…").fill("load bal");
    const first = await options(page).first().innerText();
    check("searching 'load bal' puts Load Balancer first", first.includes("Load Balancer"), first);
    await page.getByPlaceholder("Search types…").fill("messaging");
    // Search is fuzzy, so looser matches ("Secrets Manager") may follow; the category's own types come first.
    const found = (await options(page).allInnerTexts()).map((t) => t.trim());
    const messaging = found.slice(0, 2).sort();
    check("searching a category name finds its types first", JSON.stringify(messaging) === '["Event Stream","Message Queue"]', JSON.stringify(found));
    await page.getByPlaceholder("Search types…").fill("zzzz");
    check("no match says so", await picker(page).getByText("No matching type").isVisible());
    await page.keyboard.press("Escape");
    check("Esc closes the list", !(await picker(page).isVisible()));
  });

  const base = (await readDiagram(page)).past;

  await test.step("picking a type updates the box at once, as one undo step", async () => {
    await pick(page, "load", "Load Balancer");
    check("list closes after picking", !(await picker(page).isVisible()));
    check("stored type", (await typeOf(page, "Edge")) === "load-balancer");
    check("box label updates", (await boxLabel(page, "Edge").innerText()) === "LOAD BALANCER");
    check("box icon updates", (await nodeNamed(page, "Edge").locator("[data-box-icon] svg").getAttribute("class"))!.includes("lucide-split"));
    check("sidebar shows the new type", (await trigger(page).innerText()).includes("Load Balancer"));
    check("one undo step", (await readDiagram(page)).past === base + 1);
  });

  await test.step("changing type clears the technology", async () => {
    await page.getByLabel("Technology", { exact: true }).fill("Nginx");
    await page.getByLabel("Technology", { exact: true }).press("Enter");
    await pick(page, "reverse", "Reverse Proxy");
    const node = (await readDiagram(page)).nodes.find((n) => n.title === "Edge")!;
    check("the technology is cleared with the type change", node.typeId === "reverse-proxy" && !("technology" in node));
  });

  await test.step("type changes undo and redo", async () => {
    await clickBlank(page);
    await page.keyboard.press("Control+z");
    await drained(page);
    check("undo restores the previous type", (await typeOf(page, "Edge")) === "load-balancer");
    await page.keyboard.press("Control+y");
    await drained(page);
    check("redo re-applies it", (await typeOf(page, "Edge")) === "reverse-proxy");
  });

  await test.step("picking the current type again changes nothing", async () => {
    await nodeNamed(page, "Edge").click();
    const past = (await readDiagram(page)).past;
    await pick(page, "reverse", "Reverse Proxy");
    check("no undo step for a non-change", (await readDiagram(page)).past === past);
  });

  await test.step("picking Generic clears the type", async () => {
    await pick(page, "generic", "Generic");
    const node = (await readDiagram(page)).nodes.find((n) => n.title === "Edge")!;
    check("generic is stored as no type", !("typeId" in node));
    check("generic boxes have no label", (await boxLabel(page, "Edge").count()) === 0);
  });

  await test.step("works from the keyboard", async () => {
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("queue");
    await page.keyboard.press("Enter");
    check("Enter opens, typing filters, Enter picks", (await typeOf(page, "Edge")) === "message-queue");
  });

  await test.step("Esc in the list does not leave the current level", async () => {
    await clickBlank(page);
    await enter(page, "Edge");
    await page.mouse.click(500, 400, { button: "right" });
    await page.getByRole("menuitem", { name: "New box" }).click();
    await page.keyboard.press("Enter");
    await trigger(page).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("still inside the box", (await crumbs(page)).includes("Edge"), JSON.stringify(await crumbs(page)));
    check("…and the sidebar is still open", await page.locator("aside").isVisible());
  });
});

test("an unknown type shows as such in the picker, and can be replaced", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const store = window.__nestboard!.diagramStore.getState();
    const id = store.addBox(store.diagram.rootId, { x: 100, y: 100 });
    store.updateBox(id, { title: "Mystery", typeId: "quantum-router" });
  });
  await nodeNamed(page, "Mystery").click();
  const shown = await trigger(page).innerText();
  check("trigger shows the stored id and that it is unknown", shown.includes("quantum-router") && shown.includes("unknown type"), shown);
  await trigger(page).click();
  check("no type is ticked", (await picker(page).getByLabel("Current type").count()) === 0);
  await page.getByPlaceholder("Search types…").fill("cache");
  await options(page).filter({ hasText: "Cache" }).first().click();
  check("picking a type replaces the unknown id", (await typeOf(page, "Mystery")) === "cache");
});
