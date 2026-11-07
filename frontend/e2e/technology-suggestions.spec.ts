import type { Page } from "@playwright/test";
import { check, clickBlank, nodeNamed, openApp, readDiagram, test } from "./helpers";

const field = (page: Page) => page.getByLabel("Technology", { exact: true });
const list = (page: Page) => page.getByRole("listbox", { name: "Technology suggestions" });
const options = (page: Page) => list(page).locator("[data-option-text]").allInnerTexts();
const techOf = async (page: Page, title: string) =>
  (await readDiagram(page)).nodes.find((n) => n.title === title)?.technology;
const focused = (page: Page) => field(page).evaluate((el) => el === document.activeElement);

async function addBoxes(page: Page, boxes: { title: string; typeId?: string; technology?: string }[]) {
  await page.evaluate((list) => {
    const store = window.__nestboard!.diagramStore.getState();
    list.forEach((b, i) => {
      const id = store.addBox(store.diagram.rootId, { x: 100 + (i % 3) * 330, y: 100 + Math.floor(i / 3) * 250 });
      store.updateBox(id, b);
    });
  }, boxes);
}

test("a type with a technology list only allows technologies from it", async ({ page }) => {
  await openApp(page);
  await addBoxes(page, [
    { title: "Edge", typeId: "load-balancer" },
    { title: "Mesh", technology: "Kong" },
  ]);
  await nodeNamed(page, "Edge").click();

  await test.step("the list holds only the type's technologies, with logos", async () => {
    await field(page).focus();
    check("list opens on focus", await list(page).isVisible());
    check("only Load balancer technologies", JSON.stringify(await options(page)) === '["Nginx","HAProxy","AWS ALB","AWS NLB","Google Cloud Load Balancing","Azure Load Balancer","F5 BIG-IP","Envoy","Traefik"]', JSON.stringify(await options(page)));
    check("other boxes' technologies are not offered", (await list(page).getByRole("group").count()) === 1);
    check("options show their logo or monogram", (await list(page).locator("[data-tech-logo]").count()) === 9);
  });

  await test.step("typing filters; Enter picks the first match, as one undo step", async () => {
    const past = (await readDiagram(page)).past;
    await page.keyboard.type("ha");
    check("typing narrows the list", JSON.stringify(await options(page)) === '["HAProxy"]');
    check("typing alone saves nothing", (await techOf(page, "Edge")) === undefined);
    await page.keyboard.press("Enter");
    check("Enter picks it", (await techOf(page, "Edge")) === "HAProxy");
    check("…and leaves the field", !(await focused(page)) && !(await list(page).isVisible()));
    check("one undo step", (await readDiagram(page)).past === past + 1);
    check("the field shows the logo or mark", (await page.locator("aside [data-tech-logo]").count()) === 1);
  });

  await test.step("text that is not on the list is not accepted", async () => {
    await field(page).click();
    await field(page).fill("Caddy");
    check("no options match", !(await list(page).isVisible()));
    await page.keyboard.press("Enter");
    check("Enter does not save free text", (await techOf(page, "Edge")) === "HAProxy");
    await field(page).click();
    await field(page).fill("Kong");
    await clickBlank(page);
    check("leaving the field drops unmatched text", (await techOf(page, "Edge")) === "HAProxy");
    await nodeNamed(page, "Edge").click();
    check("…and shows the chosen technology again", (await field(page).inputValue()) === "HAProxy");
  });

  await test.step("one Backspace clears a chosen technology", async () => {
    const past = (await readDiagram(page)).past;
    await field(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    check("cleared in one keystroke", (await techOf(page, "Edge")) === undefined && (await field(page).inputValue()) === "");
    check("as one undo step", (await readDiagram(page)).past === past + 1);
    check("the list reopens to choose again", await list(page).isVisible());
  });

  await test.step("clicking an option picks it", async () => {
    await list(page).getByRole("option", { name: "Nginx" }).click();
    check("click picks it", (await techOf(page, "Edge")) === "Nginx");
  });

  await test.step("Esc closes the list first, then leaves the field", async () => {
    await field(page).click();
    check("(list is open)", await list(page).isVisible());
    await page.keyboard.press("Escape");
    check("first Esc closes the list", !(await list(page).isVisible()) && (await focused(page)));
    await page.keyboard.press("Escape");
    check("second Esc leaves the field", !(await focused(page)));
  });

  await test.step("changing the type clears the technology", async () => {
    await page.getByLabel("Type", { exact: true }).click();
    await page.getByPlaceholder("Search types…").fill("cache");
    await page.getByRole("option").filter({ hasText: "Cache" }).first().click();
    check("the technology is gone", (await techOf(page, "Edge")) === undefined && (await field(page).inputValue()) === "");
  });

  await test.step("a technology not on the type's list (e.g. from a file) is kept, flagged, and easy to clear", async () => {
    // Files are read as they are, so a box can arrive with any technology.
    await page.evaluate(() => {
      const store = window.__nestboard!.diagramStore.getState();
      const node = Object.values(store.diagram.nodes).find((n) => n.title === "Edge")!;
      store.updateBox(node.id, { technology: "Nginx" });
    });
    check("it is kept", (await techOf(page, "Edge")) === "Nginx");
    const hint = page.locator("aside [data-not-on-list]");
    check("the field says it is not on the list", (await hint.innerText()).includes("isn’t on the Cache list"));
    await field(page).click();
    check("the list offers the new type's technologies", JSON.stringify(await options(page)) === '["Redis","Memcached","Valkey","KeyDB","Dragonfly","Hazelcast","Amazon ElastiCache","Azure Cache for Redis","Ehcache","Upstash","Momento"]');
    await page.keyboard.press("Backspace");
    check("Backspace clears it", (await techOf(page, "Edge")) === undefined && (await hint.count()) === 0);
  });
});

test("types without a list keep free text", async ({ page }) => {
  await openApp(page);
  await addBoxes(page, [
    { title: "Shopper", typeId: "actor" },
    { title: "Plain" },
    { title: "Reminder", typeId: "note" },
    { title: "Mesh", technology: "Envoy" },
  ]);

  await test.step("User / Actor: free text, with technologies used in the diagram as suggestions", async () => {
    await nodeNamed(page, "Shopper").click();
    await field(page).focus();
    check("offers what the diagram uses", JSON.stringify(await options(page)) === '["Envoy"]', JSON.stringify(await options(page)));
    await page.keyboard.type("Customer portal");
    await page.keyboard.press("Enter");
    check("free text is kept", (await techOf(page, "Shopper")) === "Customer portal");
  });

  await test.step("Generic and Note: free text, no suggestions", async () => {
    await clickBlank(page);
    await nodeNamed(page, "Plain").click();
    await field(page).focus();
    await page.waitForTimeout(150);
    check("generic box: no list", !(await list(page).isVisible()));
    await page.keyboard.type("Node.js");
    await page.keyboard.press("Backspace");
    check("Backspace deletes one letter in free text", (await field(page).inputValue()) === "Node.j");
    await page.keyboard.press("Enter");
    await clickBlank(page);
    await nodeNamed(page, "Reminder").click();
    await field(page).focus();
    await page.waitForTimeout(150);
    check("note: no list", !(await list(page).isVisible()));
  });
});
