// The Decisions page: architecture decision records of the open project.
// Runs against the real backend on the test database; see playwright.config.ts.
// Each test has a project of its own, since ADRs are numbered per project.

import type { APIRequestContext, Page } from "@playwright/test";
import type { DiagramRecord } from "../src/api/diagrams";
import { check, createBox, expect, newProject, synced, test, type TestProject } from "./helpers";

type Saved = Pick<DiagramRecord, "id" | "version">;

/** A diagram on the server: Web, Payments › API, and a "calls" connection Web → Payments. */
async function makeDiagram(request: APIRequestContext, project: TestProject, name: string): Promise<Saved> {
  const box = (id: string, title: string, children: unknown[] = []) => ({
    id,
    title,
    position: { x: 0, y: 0 },
    children,
    edges: [],
  });
  const document = {
    schemaVersion: 4,
    root: {
      ...box("root", "Root", [box("web", "Web"), { ...box("payments", "Payments", [box("api", "API")]), position: { x: 300, y: 0 } }]),
      edges: [{ id: "calls", from: "web", to: "payments", label: "calls" }],
    },
  };
  return (await (await request.post(project.diagramsApi, { data: { name, document } })).json()) as Saved;
}

const list = (page: Page) => page.getByRole("navigation", { name: "Decisions" });
const listItem = (page: Page, ref: string) => list(page).getByRole("button", { name: new RegExp(ref) });
const detail = (page: Page) => page.locator("article");
const badge = (page: Page) => detail(page).locator("header [data-status]");
const section = (page: Page, name: string) => detail(page).getByRole("region", { name });

async function confirm(page: Page, button: string) {
  await page.getByRole("alertdialog").getByRole("button", { name: button }).click();
}

test("write, link, accept and supersede decisions", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project, "E2E decisions");
  await page.goto(`${project.base}/decisions?diagram=${diagram.id}`);

  await test.step("a project without decisions shows the ADR page straight away", async () => {
    await expect(list(page)).toContainText("No ADRs yet.");
    await expect(page.getByRole("button", { name: "New decision" })).toHaveCount(0);
    // New ADR lives in the sidebar; the top bar only exports.
    await expect(list(page).getByRole("button", { name: "New ADR" })).toBeVisible();
    // Nestboard, then the project, then the page within it; the account on the right.
    await expect(page.locator("header").getByRole("button")).toHaveText([/Nestboard/, /E2E scratch/, /Decisions/, /^E$/]);
  });

  await test.step("write the first ADR: context, a list of decisions, positive and negative consequences", async () => {
    await list(page).getByRole("button", { name: "New ADR" }).click();
    await page.getByLabel("Title").fill("Use PostgreSQL for orders");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page).toHaveURL(new RegExp(`/decisions/1\\?diagram=${diagram.id}$`));
    const form = page.getByRole("form", { name: "Edit decision" });
    await expect(form).toBeVisible(); // a new ADR opens ready to write
    await form.getByLabel("Context").fill("Orders need **transactions**.\n\n- consistency\n- durability");

    await form.getByRole("button", { name: "New decision" }).click();
    await expect(form.getByLabel("Decision 1", { exact: true })).toBeFocused();
    await page.keyboard.type("We will use PostgreSQL 18.");
    await page.keyboard.press("Enter"); // Enter starts the next item
    await expect(form.getByLabel("Decision 2", { exact: true })).toBeFocused();
    await page.keyboard.type("One database per service.");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace"); // an empty item goes away
    await expect(form.getByLabel("Decision 3", { exact: true })).toHaveCount(0);

    await form.getByRole("button", { name: "New positive consequence" }).click();
    await page.keyboard.type("Real **transactions**");
    await form.getByRole("button", { name: "New negative consequence" }).click();
    await page.keyboard.type("Another database to run");
    await form.getByRole("button", { name: "New negative consequence" }).click(); // left blank: dropped
    await page.keyboard.press("Control+Enter");

    await expect(form).toBeHidden();
    await expect(section(page, "Context").locator("strong")).toHaveText("transactions");
    await expect(section(page, "Context").locator("li")).toHaveText(["consistency", "durability"]);
    await expect(section(page, "Decision").getByRole("listitem")).toHaveText([
      "We will use PostgreSQL 18.",
      "One database per service.",
    ]);
    await expect(section(page, "Positive consequences").getByRole("listitem")).toHaveText(["Real transactions"]);
    await expect(section(page, "Positive consequences").locator("strong")).toHaveText("transactions");
    await expect(section(page, "Negative consequences").getByRole("listitem")).toHaveText(["Another database to run"]);
    await expect(listItem(page, "ADR-0001")).toContainText("Proposed");
  });

  await test.step("+ New decision on the page adds one more", async () => {
    await section(page, "Decision").getByRole("button", { name: "New decision" }).click();
    const form = page.getByRole("form", { name: "Edit decision" });
    await expect(form.getByLabel("Decision 3", { exact: true })).toBeFocused();
    await page.keyboard.type("Back it up nightly.");
    await page.keyboard.press("Control+Enter");
    await expect(section(page, "Decision").getByRole("listitem")).toHaveCount(3);
  });

  await test.step("link it to boxes and connections, and jump to a box", async () => {
    await section(page, "Diagram elements").getByRole("button", { name: "Edit links" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox", { name: /API/ }).check();
    await dialog.getByRole("checkbox", { name: /calls/ }).check();
    await dialog.getByRole("button", { name: "Save links" }).click();
    await expect(dialog).toBeHidden();
    await expect(section(page, "Diagram elements").getByRole("listitem")).toHaveText([/API/, /calls/]);

    await section(page, "Diagram elements").getByRole("button", { name: /API/ }).click();
    await expect(page).toHaveURL(new RegExp(`/editor\\?diagram=${diagram.id}$`)); // select= is consumed
    await expect(page.locator("nav[aria-label=Breadcrumb]")).toContainText("Payments");
    await expect(page.locator("aside").getByLabel("Name")).toHaveValue("API"); // selected, details open
    await page.goBack();
    await expect(detail(page)).toBeVisible();
  });

  await test.step("accept it: it can no longer be edited", async () => {
    await detail(page).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("can no longer be edited");
    await confirm(page, "Accept");
    await expect(badge(page)).toHaveText("Accepted");
    await expect(detail(page)).toContainText(/Accepted on/);
    await expect(detail(page).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(detail(page).getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });

  await test.step("supersede it with a new decision", async () => {
    await detail(page).getByRole("button", { name: "Supersede…" }).click();
    await expect(page).toHaveURL(/\/decisions\/2\?/);
    const form = page.getByRole("form", { name: "Edit decision" });
    await expect(form.getByLabel("Context")).toHaveValue(/transactions/); // starts as a copy
    await form.getByLabel("Title").fill("Use CockroachDB for orders");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(section(page, "Related decisions")).toContainText("Supersedes");
    await expect(section(page, "Related decisions")).toContainText("ADR-0001");
    await expect(section(page, "Diagram elements").getByRole("listitem")).toHaveCount(2); // links copied

    await detail(page).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("ADR-0001 will be marked superseded");
    await confirm(page, "Accept");
    await expect(badge(page)).toHaveText("Accepted");
    await expect(listItem(page, "ADR-0001")).toContainText("Superseded");
  });

  await test.step("the old decision says what replaced it, and its history shows why", async () => {
    await section(page, "Related decisions").getByRole("button", { name: /ADR-0001/ }).click();
    await expect(page).toHaveURL(/\/decisions\/1\?/);
    await expect(badge(page)).toHaveText("Superseded");
    await expect(section(page, "Related decisions")).toContainText("Superseded by");
    // History is always shown: status and change on top, then the date and time.
    const history = page.getByRole("region", { name: "History" }).getByRole("listitem");
    await expect(history.first()).toContainText("Accepted → Superseded");
    await expect(history.last()).toContainText("Created");
    await expect(page.getByRole("region", { name: "History" })).not.toContainText("Version");
    await expect(history.first().locator("time")).toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [AP]M$/);
    await expect(page.getByRole("region", { name: "History" }).getByRole("button")).toHaveCount(0);
    await expect(detail(page).locator("header p")).toHaveText(/^Accepted on \d{2} [A-Z][a-z]{2} \d{4}/);
  });

  await test.step("relations, and deleting a proposed decision", async () => {
    await list(page).getByRole("button", { name: "New ADR" }).click();
    await page.getByLabel("Title").fill("Cache order totals");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("form", { name: "Edit decision" }).getByRole("button", { name: "Cancel" }).click();

    await section(page, "Related decisions").getByRole("button", { name: "Edit relations" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Relation kind").selectOption("supersedes");
    // Only accepted decisions can be superseded.
    await expect(dialog.getByLabel("Related decision").locator("option")).toHaveText(["Choose a decision…", /ADR-0002/]);
    await dialog.getByLabel("Relation kind").selectOption("relates_to");
    await dialog.getByLabel("Related decision").selectOption({ label: "ADR-0001 · Use PostgreSQL for orders" });
    await dialog.getByRole("button", { name: "Add" }).click();
    await dialog.getByRole("button", { name: "Save relations" }).click();
    await expect(dialog).toBeHidden();
    await expect(section(page, "Related decisions")).toContainText("Relates to");

    await detail(page).getByRole("button", { name: "Delete decision" }).click();
    await confirm(page, "Delete");
    // Back to the list, which always shows an ADR: the first one.
    await expect(page).toHaveURL(new RegExp(`/decisions/1\\?diagram=${diagram.id}$`));
    await expect(list(page).getByRole("button", { name: /^ADR-/ })).toHaveCount(2);
  });

  await test.step("filter and search the list", async () => {
    const entries = list(page).getByRole("button", { name: /^ADR-/ });
    await page.getByLabel("Filter by status").selectOption("superseded");
    await expect(entries).toHaveCount(1);
    await page.getByLabel("Filter by status").selectOption("all");
    await page.getByLabel("Search ADRs").fill("cockroach");
    await expect(entries).toHaveText([/ADR-0002/]);
  });

  await test.step("export as Markdown", async () => {
    await listItem(page, "ADR-0002").click();
    const [one] = await Promise.all([page.waitForEvent("download"), detail(page).getByRole("link", { name: "Markdown" }).click()]);
    check("one decision downloads as Markdown", one.suggestedFilename() === "0002-use-cockroachdb-for-orders.md", one.suggestedFilename());
    const [all] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export all" }).click()]);
    check("all decisions download as a zip", all.suggestedFilename().endsWith("ADRs.zip"), all.suggestedFilename());
  });
});

test("a server that is down, a deleted box, and a decision changed elsewhere", async ({ page, request }) => {
  const project = await newProject(request);

  await test.step("if the server is down, the decisions say why", async () => {
    await page.goto(`${project.base}/editor`);
    await page.locator(".react-flow__pane").waitFor();
    await createBox(page, 500, 400, "Gateway");
    await synced(page);

    await page.route("**/api/**", (route) => route.abort()); // the server is down
    await page.getByRole("button", { name: /^Page: / }).click();
    await page.getByRole("menuitem", { name: /Decisions/ }).click();
    await expect(page.getByRole("heading", { name: "Couldn't load the ADRs" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Can't reach the Nestboard server");

    await page.unroute("**/api/**"); // back up
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(list(page)).toContainText("No ADRs yet.");
  });

  const diagram = await makeDiagram(request, project, "E2E orphans");
  const adr = (await (
    await request.post(project.adrsApi, { data: { title: "Put the API behind a gateway" } })
  ).json()) as { id: string; version: number };
  await request.put(`/api/v1/adrs/${adr.id}/links`, {
    data: { version: 1, links: [{ diagram_id: diagram.id, kind: "box", id: "api" }] },
  });

  await test.step("a box deleted from the diagram stays listed, marked deleted", async () => {
    const current = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Saved;
    await request.post(`/api/v1/diagrams/${diagram.id}/changes`, {
      data: { version: current.version, removed_boxes: ["api"] }, // API removed from Payments
    });

    await page.goto(`${project.base}/decisions/1?diagram=${diagram.id}`);
    const about = section(page, "Diagram elements");
    await expect(about.getByRole("listitem")).toHaveText([/API\s*deleted/]);
    await expect(about.getByRole("button", { name: /API/ })).toHaveCount(0); // nothing to jump to
  });

  await test.step("editing a decision someone else just changed explains, and shows theirs", async () => {
    await detail(page).getByRole("button", { name: "Edit", exact: true }).click();
    await request.patch(`/api/v1/adrs/${adr.id}`, { data: { version: 2, context: "Changed by someone else" } });
    const form = page.getByRole("form", { name: "Edit decision" });
    await form.getByLabel("Context").fill("My version");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toContainText("Someone else changed this decision");
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(section(page, "Context")).toContainText("Changed by someone else");
  });
});

test("layout: the header row, a middle column that scrolls alone, and focus colours", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project, "E2E layout");
  const many = Array.from({ length: 40 }, (_, i) => `Decision number ${i + 1}`);
  await request.post(project.adrsApi, {
    data: { title: "A long decision", decisions: many, positive_consequences: ["Good"], negative_consequences: ["Bad"] },
  });
  await page.goto(`${project.base}/decisions?diagram=${diagram.id}`);
  await expect(detail(page)).toBeVisible();

  await test.step("status, number and title share the top row, in that order", async () => {
    const row = detail(page).locator("header > div").first();
    await expect(row).toHaveText(/^Proposed\s*ADR-0001\s*A long decision$/);
  });

  await test.step("only the middle column scrolls; the sidebars stay put", async () => {
    const pageScrolls = await page.evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight);
    check("the page itself does not scroll", !pageScrolls);
    const middle = detail(page).locator("> div").first();
    const scrollable = await middle.evaluate((el) => el.scrollHeight > el.clientHeight);
    check("the middle column scrolls", scrollable);
    const asideBefore = await detail(page).locator("aside").boundingBox();
    const listBefore = await list(page).boundingBox();
    await middle.evaluate((el) => el.scrollBy(0, 600));
    await expect.poll(() => middle.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    check("the right panel did not move", JSON.stringify(await detail(page).locator("aside").boundingBox()) === JSON.stringify(asideBefore));
    check("the ADR list did not move", JSON.stringify(await list(page).boundingBox()) === JSON.stringify(listBefore));
  });

  await test.step("focused fields: white; positive green; negative red", async () => {
    await detail(page).getByRole("button", { name: "Edit", exact: true }).click();
    const form = page.getByRole("form", { name: "Edit decision" });
    const borderWhenFocused = async (label: string) => {
      const box = form.getByLabel(label, { exact: true });
      await box.focus();
      return box.evaluate((el) => getComputedStyle(el).borderTopColor);
    };
    const title = await borderWhenFocused("Title");
    const decision = await borderWhenFocused("Decision 1");
    const positive = await borderWhenFocused("Positive consequence 1");
    const negative = await borderWhenFocused("Negative consequence 1");
    check("title and decisions turn white", title === "rgb(231, 233, 238)" && decision === title, `${title} / ${decision}`);
    check("positive and negative each have their own colour", new Set([title, positive, negative]).size === 3, `${positive} / ${negative}`);
    // The title box sits in the header row, after the status and number.
    await expect(detail(page).locator("header > div").first().getByLabel("Title", { exact: true })).toHaveValue("A long decision");
  });
});

test("leaving an ADR with unsaved edits asks first", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project, "E2E unsaved");
  for (const title of ["First", "Second"]) {
    await request.post(project.adrsApi, { data: { title, context: "Saved text" } });
  }
  await page.goto(`${project.base}/decisions/1?diagram=${diagram.id}`);
  await detail(page).getByRole("button", { name: "Edit", exact: true }).click();
  const form = page.getByRole("form", { name: "Edit decision" });
  const discardDialog = page.getByRole("alertdialog");

  await test.step("an untouched editor lets you go", async () => {
    await listItem(page, "ADR-0002").click();
    await expect(page).toHaveURL(/\/decisions\/2\?/);
    await expect(discardDialog).toHaveCount(0);
    await listItem(page, "ADR-0001").click();
    await detail(page).getByRole("button", { name: "Edit", exact: true }).click();
  });

  await form.getByLabel("Context").fill("Typed but not saved");

  await test.step("another ADR: Cancel keeps you and your text", async () => {
    await listItem(page, "ADR-0002").click();
    await expect(discardDialog).toContainText("Your changes to ADR-0001 have not been saved.");
    await discardDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/decisions\/1\?/);
    await expect(form.getByLabel("Context")).toHaveValue("Typed but not saved");
  });

  await test.step("another page and the Back button ask too", async () => {
    await page.getByRole("button", { name: /^Page: / }).click();
    await page.getByRole("menuitem", { name: /Editor/ }).click();
    await expect(discardDialog).toBeVisible();
    await page.keyboard.press("Escape"); // same as Cancel
    await expect(page).toHaveURL(/\/decisions\/1\?/);

    await page.goBack();
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(form.getByLabel("Context")).toHaveValue("Typed but not saved");
  });

  // Reload, not close: this headless browser skips beforeunload when a page is closed.
  await test.step("reloading the tab warns", async () => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.reload({ timeout: 1500 }).catch(() => {});
    await expect.poll(() => dialogs.join()).toBe("beforeunload");
    await expect(form.getByLabel("Context")).toHaveValue("Typed but not saved");
  });

  await test.step("Discard changes goes on, and nothing was saved", async () => {
    await listItem(page, "ADR-0002").click();
    await discardDialog.getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/\/decisions\/2\?/);
    await expect(form).toHaveCount(0);
    await listItem(page, "ADR-0001").click(); // nothing being edited now: no question
    await expect(discardDialog).toHaveCount(0);
    await expect(section(page, "Context")).toContainText("Saved text");
  });
});

test("opening a decisions link in a fresh tab opens that diagram, and creates no other", async ({ page, request }) => {
  const project = await newProject(request);
  const diagram = await makeDiagram(request, project, "E2E link");
  await request.post(project.adrsApi, { data: { title: "Linked decision" } });
  // Only this tab's requests: other tests create diagrams at the same time.
  const saves: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && /\/api\/v1\/.*diagrams/.test(r.url())) saves.push(`${r.method()} ${r.url()}`);
  });

  await page.goto(`${project.base}/decisions/1?diagram=${diagram.id}`);

  await expect(detail(page)).toContainText("Linked decision");
  await expect(page).toHaveURL(new RegExp(`/decisions/1\\?diagram=${diagram.id}$`));
  check("nothing was saved while the linked diagram opened", saves.length === 0, saves.join(", "));
});
