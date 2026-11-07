// Who may change what: locked boxes and who is in charge in the editor,
// decisions about a box, the People page, the organization's members and
// groups, and reset links. Each test has a project of its own; a second
// person (Bob) joins the organization through an invitation.

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import {
  center,
  createBox,
  drag,
  expect,
  handle,
  newProject,
  nodeNamed,
  ORG_ID,
  ORG_PATH,
  test,
  watchConsole,
  type TestProject,
} from "./helpers";

const PASSWORD = "bob's password";

/** Shop ▸ Payments, Shop ▸ Orders, and Web. */
async function makeDiagram(request: APIRequestContext, project: TestProject) {
  const box = (id: string, title: string, children: unknown[] = [], x = 0) => ({
    id,
    title,
    position: { x, y: 0 },
    children,
    edges: [],
  });
  const document = {
    schemaVersion: 4,
    root: box("root", "Root", [box("shop", "Shop", [box("payments", "Payments"), box("orders", "Orders", [], 300)]), box("web", "Web", [], 300)]),
  };
  const response = await request.post(project.diagramsApi, { data: { name: "Shop", document } });
  return (await response.json()) as { id: string };
}

/** Someone new in the organization, signed in in a browser of their own. */
async function newPerson(browser: Browser, request: APIRequestContext, name: string) {
  const invitation = (await (await request.post(`/api/v1/orgs/${ORG_ID}/invitations`, { data: {} })).json()) as { token: string };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const signUp = await context.request.post(`/api/v1/invitations/${invitation.token}/sign-up`, {
    data: { email, display_name: name, password: PASSWORD },
  });
  expect(signUp.ok(), await signUp.text()).toBe(true);
  const { user } = (await signUp.json()) as { user: { id: string } };
  const page = await context.newPage();
  return { page, id: user.id, email, errors: watchConsole(page), close: () => context.close() };
}

async function grantBox(request: APIRequestContext, project: TestProject, diagramId: string, userId: string, boxId: string) {
  const response = await request.put(`/api/v1/projects/${project.id}/grants`, {
    data: { user_id: userId, role: "owner", diagram_id: diagramId, box_id: boxId },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const enter = async (page: Page, name: string) => {
  await nodeNamed(page, name).dblclick();
  await expect(page.locator("nav[aria-label=Breadcrumb]")).toContainText(name);
};

test("someone in charge of a box changes only inside it", async ({ browser, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project);
  const bob = await newPerson(browser, request, "Bob");
  await grantBox(request, project, diagram.id, bob.id, "payments");
  const page = bob.page;
  await page.goto(`${project.base}/editor?diagram=${diagram.id}`);
  await page.locator(".react-flow__pane").waitFor();

  await test.step("outside their box, everything is locked", async () => {
    await expect(nodeNamed(page, "Shop").locator("[data-locked]")).toBeVisible();
    await page.mouse.click(600, 600, { button: "right" });
    await expect(page.getByRole("menu")).toContainText("You can look here but not add boxes");
    await page.keyboard.press("Escape");
  });

  await test.step("their box shows them in charge, and its neighbours stay locked", async () => {
    await enter(page, "Shop");
    await expect(nodeNamed(page, "Payments").locator("[data-in-charge]")).toHaveText("Bob");
    await expect(nodeNamed(page, "Payments").locator("[data-locked]")).toHaveCount(0);
    await expect(nodeNamed(page, "Orders").locator("[data-locked]")).toBeVisible();

    await nodeNamed(page, "Orders").click();
    await expect(page.locator("aside [data-locked-note]")).toContainText("not change it");
    await page.keyboard.press("Delete");
    await expect(page.getByRole("status")).toContainText('You can\'t delete "Orders"');
    await expect(nodeNamed(page, "Orders")).toBeVisible();
  });

  /** Whether the "External box…" placeholder shows while a line is dragged from a box. */
  const placeholderWhileDragging = async (from: string) => {
    await nodeNamed(page, from).hover();
    const start = await center(handle(page, from, "right"));
    let shown = false;
    await drag(page, start, { x: start.x + 120, y: start.y + 160 }, {
      midway: async () => {
        shown = (await page.locator("[data-external-placeholder]").count()) === 1;
      },
    });
    return shown;
  };

  await test.step("they may not connect their box outside the level it is on", async () => {
    expect(await placeholderWhileDragging("Payments")).toBe(false);
  });

  await test.step("inside it they draw and save", async () => {
    await nodeNamed(page, "Payments").click();
    await expect(page.locator("aside").getByRole("button", { name: "Give access…" })).toBeVisible();
    await enter(page, "Payments");
    await createBox(page, 500, 400, "Ledger");
    // Inside their box, lines from it may go anywhere.
    expect(await placeholderWhileDragging("Ledger")).toBe(true);
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => JSON.stringify((await (await bob.page.request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as unknown))
      .toContain("Ledger");
  });

  expect(bob.errors).toEqual([]);
  await bob.close();
});

test("decisions about a box: written and decided by whoever is in charge of it", async ({ browser, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project);
  await request.post(project.adrsApi, { data: { title: "A rule for everyone" } });
  const bob = await newPerson(browser, request, "Bob");
  await grantBox(request, project, diagram.id, bob.id, "payments");
  const page = bob.page;
  await page.goto(`${project.base}/decisions?diagram=${diagram.id}`);
  const list = page.getByRole("navigation", { name: "Decisions" });

  await test.step("a decision about the whole project is read-only for them", async () => {
    await expect(list.getByRole("listitem", { name: "Whole project" })).toContainText("A rule for everyone");
    const detail = page.locator("article");
    await expect(detail.locator("[data-scope-line]")).toContainText("About the whole project");
    await expect(detail.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Edit links" })).toHaveCount(0);
  });

  await test.step("they write one about their box, and may accept it", async () => {
    await list.getByRole("button", { name: "New ADR" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("About").locator("option")).toHaveText(["Shop › Payments"]);
    await dialog.getByLabel("Title").fill("Keep a ledger");
    await dialog.getByRole("button", { name: "Create" }).click();
    await page.getByRole("form", { name: "Edit decision" }).getByRole("button", { name: "Cancel" }).click();

    await expect(list.getByRole("listitem", { name: "Shop › Payments" })).toContainText("Keep a ledger");
    const detail = page.locator("article");
    await expect(detail.locator("[data-scope-line]")).toContainText("About Payments");
    await detail.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Accept" }).click();
    await expect(detail.locator("header [data-status]")).toHaveText("Accepted");
    await expect(detail.locator("header p")).toContainText("by Bob");
  });

  expect(bob.errors).toEqual([]);
  await bob.close();
});

test("the People page shows who is in charge of what, and what changed", async ({ browser, page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project);
  const bob = await newPerson(browser, request, "Bob");
  await grantBox(request, project, diagram.id, bob.id, "payments");

  await page.goto(`${project.base}/people`);
  const boxes = page.getByRole("region", { name: "Boxes" });
  await expect(boxes).toContainText("Shop › Payments");
  await expect(boxes.getByLabel("Role of Bob")).toHaveValue("owner");
  await expect(page.getByRole("region", { name: "Whole project" }).getByLabel("Role of E2E")).toHaveValue("owner");
  await expect(page.getByRole("region", { name: "Activity" })).toContainText("put Bob in charge of Payments");

  await test.step("an owner changes a role here", async () => {
    await boxes.getByLabel("Role of Bob").selectOption("editor");
    await expect(boxes.getByLabel("Role of Bob")).toHaveValue("editor");
  });
  await bob.close();
});

test("the organization's members, invitations and groups", async ({ browser, page, request }) => {
  const bob = await newPerson(browser, request, "Bob");

  await test.step("the Nestboard menu leads to the organization's page", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Nestboard menu" }).click();
    await page.getByRole("menuitem", { name: /^E2E/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG_PATH}$`));
    const tabs = page.getByRole("navigation", { name: "Organization", exact: true }).getByRole("link");
    await expect(tabs).toHaveText(["Invitations", "Members", "Groups", "Projects"]);
    await expect(tabs.filter({ hasText: "Projects" })).toHaveAttribute("aria-current", "page");
    await tabs.filter({ hasText: "Members" }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG_PATH}#members$`));
  });

  await test.step("members are listed, with job titles", async () => {
    const members = page.getByRole("region", { name: "Members" });
    await expect(members).toContainText(bob.email);
    await members.getByLabel("Job title of Bob").first().fill("Developer");
    await members.getByLabel("Job title of Bob").first().press("Enter");
    await expect(members.getByLabel("Job title of Bob").first()).toHaveValue("Developer");
  });

  await test.step("an invitation link is made to send by hand", async () => {
    await page.getByRole("navigation", { name: "Organization", exact: true }).getByRole("link", { name: /Invitations/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ORG_PATH}#invitations$`));
    // Which role to give: a table of what each one can do.
    await page.getByRole("button", { name: "What can each role do?" }).click();
    const guide = page.getByRole("dialog");
    await expect(guide.getByRole("columnheader")).toHaveText(["Can…", "Owner", "Admin", "Member"]);
    const changeRoles = guide.getByRole("row", { name: /Change roles/ });
    await expect(changeRoles.getByRole("img", { name: "Yes" })).toHaveCount(1); // owners only
    await expect(guide.getByRole("row", { name: /Invite people/ })).toContainText("Members only");
    await guide.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Create invitation link" }).click();
    await expect(page.getByLabel("Invitation link")).toHaveValue(/\/invite\/[\w-]+$/);
  });

  await test.step("groups nest, and have people and leads", async () => {
    const name = `Team ${Date.now()}`;
    await page.getByRole("navigation", { name: "Organization", exact: true }).getByRole("link", { name: /Groups/ }).click();
    const groups = page.getByRole("region", { name: "Groups", exact: true });
    await groups.getByRole("button", { name: "New group" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    // The new group is picked: its details on the right.
    const detail = groups.getByRole("article", { name });
    await expect(detail.getByRole("heading", { name })).toBeVisible();
    await detail.getByLabel(`Add someone to ${name}`).selectOption({ label: "Bob" });
    await detail.getByRole("button", { name: "Add", exact: true }).click();
    await expect(detail.getByRole("button", { name: `Take Bob out of ${name}` })).toBeVisible();
    await expect(detail).toContainText("People (1)");
    await expect(groups.getByRole("list", { name: "Group tree" }).getByRole("button", { name: new RegExp(`${name}\\s*1$`) })).toBeVisible();
  });

  await test.step("a tab's address opens it", async () => {
    await page.goto(`${ORG_PATH}#groups`);
    await expect(page.getByRole("region", { name: "Groups", exact: true })).toBeVisible();
  });
  await bob.close();
});

test("the instance admin makes reset links", async ({ browser, page, request }) => {
  const bob = await newPerson(browser, request, "Bob");
  await page.goto("/admin");
  const row = page.getByRole("listitem").filter({ hasText: bob.email });
  await row.getByRole("button", { name: "Reset link" }).click();
  await expect(row.getByLabel("Reset link for Bob")).toHaveValue(/\/reset-password\/[\w-]+$/);
  await bob.close();
});
