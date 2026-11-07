// Signing in and out, joining through an invitation, and projects on the home page.

import type { Browser } from "@playwright/test";
import { E2E_ACCOUNT } from "./account";
import { BASE, createBox, cutLiveConnections, expect, openApp, ORG_ID, ORG_PATH, test, watchConsole } from "./helpers";

/** A browser with nobody signed in. (Signing out of the shared test session would sign every test out.) */
async function freshPage(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  return { page, errors: watchConsole(page), close: () => context.close() };
}

test("signing in, and out again", async ({ browser }) => {
  const { page, errors, close } = await freshPage(browser);

  // A project page asks to sign in first, and comes back afterwards.
  await page.goto(`${BASE}/editor`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.getByLabel("Email").fill(E2E_ACCOUNT.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("The email or password is wrong.");

  await page.getByLabel("Password").fill(E2E_ACCOUNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/editor$`));
  await page.locator(".react-flow__pane").waitFor();
  await expect(page.getByTitle("Switch project")).toHaveText("E2E/E2E project");

  await page.getByRole("button", { name: `Account: ${E2E_ACCOUNT.displayName}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Signing in again would come back to the editor.
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(`${BASE}/editor`)}$`));
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);

  expect(errors).toEqual([]);
  await close();
});

test("an invitation link signs someone up into the organization", async ({ browser, request }) => {
  const invitation = (await (
    await request.post(`/api/v1/orgs/${ORG_ID}/invitations`, { data: { title: "Developer" } })
  ).json()) as { token: string };
  const { page, errors, close } = await freshPage(browser);
  const email = `invitee-${Date.now()}@example.com`;

  await page.goto(`/invite/${invitation.token}`);
  await expect(page.getByText(/invited you to join E2E as a member \(Developer\)/)).toBeVisible();
  await page.getByLabel("Your name").fill("Invitee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("invitee password");
  await page.getByRole("button", { name: "Create account and join" }).click();

  // The organization joined, on its projects: none given to them yet.
  await expect(page).toHaveURL(new RegExp(`${ORG_PATH}$`));
  const section = page.getByRole("region", { name: "Projects" });
  await expect(section).toContainText("No projects yet.");
  await expect(section.getByRole("button", { name: "New project" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Organization", exact: true }).getByRole("link")).toHaveText([
    "Members",
    "Groups",
    "Projects",
  ]); // no Invitations for a member
  // Without a grant, the e2e project does not exist for them.
  await page.goto(`${BASE}/editor`);
  await expect(page.getByRole("heading", { name: "This project doesn't exist" })).toBeVisible();

  // The link worked once.
  await page.goto(`/invite/${invitation.token}`);
  await expect(page.getByRole("heading", { name: "This invitation can't be used" })).toBeVisible();

  expect(errors).toEqual([]);
  await close();
});

test("creating a project from the organization's page opens it", async ({ page }) => {
  const name = `Project ${Date.now()}`;
  await page.goto(ORG_PATH); // its projects, to start with
  await page.getByRole("region", { name: "Projects" }).getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page).toHaveURL(new RegExp(`${ORG_PATH}/projects/[\\w-]+/editor$`));
  await page.locator(".react-flow__pane").waitFor();
  await expect(page.getByTitle("Switch project")).toContainText(name);

  // Its diagrams are its own: the open dialog lists none.
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("dialog")).toContainText(/No diagrams/i);
});

test("leaving a project with changes that could not reach the server asks first", async ({ page }) => {
  await openApp(page);
  // The diagram goes to the server with its first box; after that, nothing gets through.
  await cutLiveConnections(page);
  await createBox(page, 500, 400, "Saved");
  await page.waitForFunction(() => window.__nestboard!.documentStore.getState().id !== null);
  await createBox(page, 800, 400, "Unsent");
  await expect(page.getByRole("button", { name: /^File:/ })).toHaveAccessibleName(/offline/);

  await page.getByRole("button", { name: "Nestboard menu" }).click();
  await page.getByRole("menuitem", { name: /All organizations/i }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Leave without saving?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE}/editor\\?diagram=[\\w-]+$`));

  await page.getByRole("button", { name: "Nestboard menu" }).click();
  await page.getByRole("menuitem", { name: /All organizations/i }).click();
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations(/${ORG_ID})?$`));
});
