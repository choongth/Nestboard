// The page switcher at the top-left: Editor, Decisions, and pages to come.

import { BASE, createBox, expect, openApp, ORG_ID, ORG_PATH, readDiagram, synced, test } from "./helpers";

const switcher = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Page: / });

/** A page's address, with or without the open diagram's id. */
const at = (path: string) => new RegExp(`${path}(\\?diagram=[\\w-]+)?$`);

test("switch between the editor and the decisions page", async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveURL(/\/editor$/);
  await expect(switcher(page)).toHaveAccessibleName("Page: Editor. Switch page");
  await createBox(page, 500, 400, "Payments");
  // The diagram went to the server with its first box: the address names it.
  await synced(page);

  await switcher(page).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText([/Editor/, /Decisions/, /People/]);
  await page.getByRole("menuitem", { name: /Decisions/ }).click();

  await expect(page).toHaveURL(new RegExp(`/decisions\\?diagram=[\\w-]+$`));
  await expect(switcher(page)).toHaveAccessibleName("Page: Decisions. Switch page");
  await expect(page.getByRole("navigation", { name: "Decisions" })).toBeVisible();
  await expect(page).toHaveTitle(/^Decisions · E2E project/);

  // The open diagram survives the round trip, whichever way you come back.
  await page.goBack();
  await expect(page).toHaveURL(at("/editor"));
  await page.locator(".react-flow__pane").waitFor();
  expect((await readDiagram(page)).titles).toEqual(["Payments"]);

  await page.goForward();
  await switcher(page).click();
  await page.getByRole("menuitem", { name: /Editor/ }).click();
  await expect(page).toHaveURL(at("/editor"));
  await expect(page.locator(".react-flow__node", { hasText: "Payments" })).toBeVisible();
});

test("every address lands on a page", async ({ page }) => {
  // A project's own address opens its editor.
  await page.goto(BASE);
  await expect(page).toHaveURL(new RegExp(`${BASE}/editor$`));
  // Anything else goes to your organizations (straight to the one, if only one).
  await page.goto("/no/such/page");
  await expect(page).toHaveURL(new RegExp(`/organizations(/${ORG_ID})?$`));
  await expect(page.getByRole("navigation", { name: "Organizations" }).getByRole("link", { name: /^E2E/ })).toBeVisible();
  // A page's own address works when loaded directly.
  await page.goto(`${BASE}/decisions`);
  await expect(page.getByRole("navigation", { name: "Decisions" })).toBeVisible();
});

test("a page whose code is gone, after a release, offers to reload", async ({ page }) => {
  // A tab opened before the release asks for the old version's file, which the server no longer has.
  await page.route(/\/assets\/ProjectShell-[\w-]+\.js$/, (route) => route.fulfill({ status: 404 }));
  await page.goto(`${BASE}/editor`);
  await expect(page.getByRole("heading", { name: "Nestboard has been updated" })).toBeVisible();

  await page.unrouteAll();
  await page.getByRole("button", { name: "Reload" }).click();
  await page.locator(".react-flow__pane").waitFor();
});

test("a project that does not exist says so", async ({ page }) => {
  await page.goto(`${ORG_PATH}/projects/00000000-0000-0000-0000-000000000000/editor`);
  await expect(page.getByRole("heading", { name: "This project doesn't exist" })).toBeVisible();
  await page.getByRole("link", { name: "Your projects" }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations(/${ORG_ID})?$`));
});
