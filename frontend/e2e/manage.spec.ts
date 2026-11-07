// Renaming and deleting what the backend could always rename and delete:
// diagrams, projects, organizations; moving groups; and cutting a box that
// people are in charge of.

import type { APIRequestContext } from "@playwright/test";
import { expect, newProject, nodeNamed, ORG_ID, test, type TestProject } from "./helpers";

/** Shop, with Payments inside it. */
async function makeDiagram(request: APIRequestContext, project: TestProject, name = "Shop") {
  const box = (id: string, title: string, children: unknown[] = []) => ({ id, title, position: { x: 0, y: 0 }, children, edges: [] });
  const document = { schemaVersion: 4, root: box("root", "Root", [box("shop", "Shop", [box("payments", "Payments")])]) };
  return (await (await request.post(project.diagramsApi, { data: { name, document } })).json()) as { id: string };
}

test("a project owner deletes a diagram from the file menu", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project, "Old diagram");
  await page.goto(`${project.base}/editor?diagram=${diagram.id}`);
  await page.locator(".react-flow__pane").waitFor();

  await page.getByRole("button", { name: /^File: Old diagram/ }).click();
  await page.getByRole("menuitem", { name: "Delete diagram…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("decisions stay");
  await page.getByRole("button", { name: "Delete diagram" }).click();

  await expect(page.getByRole("button", { name: /^File: Untitled/ })).toBeVisible();
  expect((await request.get(`/api/v1/diagrams/${diagram.id}`)).status()).toBe(404);
});

test("a project owner renames and deletes the project", async ({ page, request }) => {
  const project = await newProject(request, "Doomed");
  await page.goto(`${project.base}/editor`);
  await page.locator(".react-flow__pane").waitFor();
  const crumb = page.getByTitle("Switch project");

  await test.step("rename", async () => {
    await crumb.click();
    await page.getByRole("menuitem", { name: "Rename project…" }).click();
    await page.getByLabel("Project name").fill("Renamed project");
    await page.getByLabel("Project name").press("Enter");
    await expect(crumb).toContainText("Renamed project");
  });

  await test.step("delete, typing its name to confirm", async () => {
    await crumb.click();
    await page.getByRole("menuitem", { name: "Delete project…" }).click();
    const dialog = page.getByRole("dialog");
    const remove = dialog.getByRole("button", { name: "Delete", exact: true });
    await expect(remove).toBeDisabled();
    await dialog.getByRole("textbox").fill("Renamed project");
    await remove.click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${ORG_ID}$`));
    expect((await request.get(`/api/v1/projects/${project.id}`)).status()).toBe(404);
  });
});

test("an organization owner renames and deletes the organization", async ({ page, request }) => {
  const name = `Temp org ${Date.now()}`;
  const org = (await (await request.post("/api/v1/orgs", { data: { name } })).json()) as { id: string };
  await page.goto(`/organizations/${org.id}`);
  const sidebar = page.getByRole("navigation", { name: "Organizations" });

  await sidebar.getByRole("button", { name: `Manage ${name}` }).click();
  await page.getByRole("menuitem", { name: "Rename organization…" }).click();
  await page.getByLabel("Organization name").fill(`${name} renamed`);
  await page.getByLabel("Organization name").press("Enter");
  await expect(sidebar.getByRole("link", { name: new RegExp(`${name} renamed`) })).toBeVisible();

  await sidebar.getByRole("button", { name: `Manage ${name} renamed` }).click();
  await page.getByRole("menuitem", { name: "Delete organization…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(`${name} renamed`);
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  await expect.poll(async () => (await request.get(`/api/v1/orgs/${org.id}`)).status()).toBe(404);
});

test("a group moves under another, or back to the top", async ({ page, request }) => {
  const stamp = Date.now();
  const make = async (name: string) =>
    (await (await request.post(`/api/v1/orgs/${ORG_ID}/groups`, { data: { name } })).json()) as { id: string };
  const parent = await make(`Platform ${stamp}`);
  const child = await make(`Payments ${stamp}`);
  const parentOf = async () =>
    ((await (await request.get(`/api/v1/orgs/${ORG_ID}/groups/${child.id}`)).json()) as { parent_id: string | null }).parent_id;
  await page.goto(`/organizations/${ORG_ID}#groups`);
  const groups = page.getByRole("region", { name: "Groups", exact: true });
  await groups.getByRole("list", { name: "Group tree" }).getByRole("button", { name: new RegExp(`Payments ${stamp}`) }).click();

  await groups.getByRole("button", { name: `Move Payments ${stamp}` }).click();
  await page.getByRole("dialog").getByLabel("Inside").selectOption({ label: `Platform ${stamp}` });
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(parentOf).toBe(parent.id);

  await groups.getByRole("button", { name: `Move Payments ${stamp}` }).click();
  // Not inside itself: only other groups, and the top level.
  await expect(page.getByRole("dialog").getByLabel("Inside").locator("option", { hasText: `Payments ${stamp}` })).toHaveCount(0);
  await page.getByRole("dialog").getByLabel("Inside").selectOption({ label: "Top level" });
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect.poll(parentOf).toBe(null);
});

test("cutting a box someone is in charge of asks first", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project);
  const team = (await (await request.post(`/api/v1/orgs/${ORG_ID}/groups`, { data: { name: `Team ${Date.now()}` } })).json()) as {
    id: string;
  };
  await request.put(`/api/v1/projects/${project.id}/grants`, {
    data: { group_id: team.id, role: "owner", diagram_id: diagram.id, box_id: "payments" },
  });
  await page.goto(`${project.base}/editor?diagram=${diagram.id}`);
  await page.locator(".react-flow__pane").waitFor();
  // Nothing on the top level shows the grant inside Shop: wait until the
  // editor has loaded it.
  await page.waitForFunction(() => window.__nestboard!.accessStore.getState().grants.some((g) => g.box_id === "payments"));

  // Shop holds Payments, which has people in charge.
  await nodeNamed(page, "Shop").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Cut/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText('"Payments" has people in charge');
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(nodeNamed(page, "Shop")).toBeVisible();

  await nodeNamed(page, "Shop").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Cut/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cut anyway" }).click();
  await expect(nodeNamed(page, "Shop")).toHaveCount(0);
});
