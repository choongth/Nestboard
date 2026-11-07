import { readFileSync } from "node:fs";
import { test as base, expect, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import type {} from "../src/devHooks";
import type { BoxNode, DiagramFile, Edge } from "../src/model/types";
import { E2E_PROJECT_FILE } from "./account";

/**
 * Every test fails if the page logs a console error or throws. Pages a test
 * opens itself (e.g. in a second context) can use `watchConsole`.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors = watchConsole(page);
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    // The browser logs every 4xx/5xx response; the app handles those itself
    // (a conflict, a missing diagram), so only the app's own errors count.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/**
 * A named check that does not stop the test when it fails, so one run reports
 * every broken behaviour rather than just the first.
 */
export function check(name: string, ok: boolean, detail?: string) {
  expect.soft(ok, detail ? `${name} — ${detail}` : name).toBe(true);
}

const { id: PROJECT_ID, orgId } = JSON.parse(readFileSync(E2E_PROJECT_FILE, "utf8")) as {
  id: string;
  orgId: string;
};
/** The organization the tests work in (see global-setup.ts). */
export const ORG_ID = orgId;
/** Its page: /organizations/<id>. Ids are letters, digits and hyphens, so it reads as a pattern too. */
export const ORG_PATH = `/organizations/${ORG_ID}`;
/** The project every test works in: its pages are under BASE. */
export const BASE = `${ORG_PATH}/projects/${PROJECT_ID}`;
/** Where the project's diagrams are listed and created on the server. */
export const DIAGRAMS_API = `/api/v1/projects/${PROJECT_ID}/diagrams`;
/** Where who may do what in the project is given (see the server's README). */
export const GRANTS_API = `/api/v1/projects/${PROJECT_ID}/grants`;

/**
 * Someone else in the organization, with `role` in the shared project: a
 * browser of their own, signed in as them (who joined through an invitation).
 */
export async function someoneElse(browser: Browser, request: APIRequestContext, name: string, role = "editor") {
  const invited = await request.post(`/api/v1/orgs/${ORG_ID}/invitations`, { data: {} });
  const { token } = (await invited.json()) as { token: string };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}@example.com`;
  const signedUp = await context.request.post(`/api/v1/invitations/${token}/sign-up`, {
    data: { email, display_name: name, password: "someone else" },
  });
  expect(signedUp.ok(), await signedUp.text()).toBe(true);
  const { user } = (await signedUp.json()) as { user: { id: string } };
  const granted = await request.put(GRANTS_API, { data: { role, user_id: user.id } });
  expect(granted.ok(), await granted.text()).toBe(true);
  const page = await context.newPage();
  return { page, userId: user.id, errors: watchConsole(page), close: () => context.close() };
}

export interface TestProject {
  id: string;
  /** Its pages are under here. */
  base: string;
  diagramsApi: string;
  adrsApi: string;
}

/**
 * A project of its own, for a test that must not see what tests running at
 * the same time do in the shared one (e.g. ADR numbers, counted per project).
 */
export async function newProject(request: APIRequestContext, name = "E2E scratch"): Promise<TestProject> {
  const tag = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`/api/v1/orgs/${ORG_ID}/projects`, { data: { name: `${name} ${tag}` } });
  expect(response.ok(), await response.text()).toBe(true);
  const { id } = (await response.json()) as { id: string };
  return {
    id,
    base: `${ORG_PATH}/projects/${id}`,
    diagramsApi: `/api/v1/projects/${id}/diagrams`,
    adrsApi: `/api/v1/projects/${id}/adrs`,
  };
}

export async function openApp(page: Page) {
  await page.goto(`${BASE}/editor`);
  await page.locator(".react-flow__pane").waitFor();
}

// ---- Reading app state (through the dev-only window.__nestboard hook) ----

export interface DiagramSnapshot {
  rootId: string;
  nodes: BoxNode[];
  edges: (Edge & { fromTitle?: string; toTitle?: string })[];
  /** Titles of every box except the root, sorted. */
  titles: string[];
  past: number;
  future: number;
}

export function readDiagram(page: Page): Promise<DiagramSnapshot> {
  return page.evaluate(() => {
    const store = window.__nestboard!.diagramStore;
    const d = store.getState().diagram;
    const history = store.temporal.getState();
    const nodes = Object.values(d.nodes);
    return {
      rootId: d.rootId,
      nodes,
      edges: Object.values(d.edges).map((e) => ({
        ...e,
        fromTitle: d.nodes[e.from]?.title,
        toTitle: d.nodes[e.to]?.title,
      })),
      titles: nodes
        .filter((n) => n.parentId)
        .map((n) => n.title)
        .sort(),
      past: history.pastStates.length,
      future: history.futureStates.length,
    };
  });
}

// ---- Finding things ----

export const nodeNamed = (page: Page, name: string) => page.locator(".react-flow__node", { hasText: name }).first();

export const handle = (page: Page, name: string, side: "top" | "right" | "bottom" | "left") =>
  nodeNamed(page, name).locator(`.react-flow__handle-${side}`);

export async function center(locator: Locator) {
  const b = (await locator.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Breadcrumb segments, e.g. ["Root", "Payments"]. */
export const crumbs = (page: Page) =>
  page.locator("nav[aria-label=Breadcrumb] > button, nav[aria-label=Breadcrumb] > span").allInnerTexts();

export const sidebarHeading = (page: Page) =>
  page
    .locator("aside h2")
    .textContent({ timeout: 500 })
    .catch(() => null);

export const sidebarOpen = (page: Page) => page.locator("aside").isVisible();

// ---- Doing things ----

/** Clicks an empty corner of the canvas (deselects, closes the sidebar). */
export const clickBlank = (page: Page) => page.mouse.click(30, 820);

/** Right-click → New box at (x, y), name it, then deselect. */
export async function createBox(page: Page, x: number, y: number, name: string) {
  await page.mouse.click(x, y, { button: "right" });
  await page.getByRole("menuitem", { name: "New box" }).click();
  // The sidebar opens with its Name field focused; typing sooner loses keys.
  // Under heavy load (right after another diagram opened) the focus can go
  // astray; then the field is clicked into, as a person would.
  const field = page.locator("aside").getByLabel("Name");
  try {
    await expect(field).toBeFocused({ timeout: 3000 });
  } catch {
    await field.click();
    await field.selectText();
  }
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await clickBlank(page);
}

type Point = { x: number; y: number };

/** A mouse drag in small steps, like a real hand. `midway` runs before releasing. */
export async function drag(page: Page, from: Point, to: Point, options: { steps?: number; midway?: () => Promise<void> } = {}) {
  const steps = options.steps ?? 20;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await options.midway?.();
  await page.mouse.up();
}

/** Waits for level transitions (stage animations) to finish. */
export async function settled(page: Page) {
  await page.waitForTimeout(60);
  await page.waitForFunction(() => document.querySelector("[data-canvas-stage]")!.getAnimations().length === 0);
}

/**
 * Changes save themselves a moment after they are made: waits until the
 * server has all of them (and a new diagram is on it).
 */
export async function synced(page: Page) {
  await page.waitForFunction(() => {
    const { unsaved, id, sync } = window.__nestboard!.documentStore.getState();
    return !unsaved && id !== null && sync === "saved";
  });
}

/**
 * Live connections to diagrams opened from now on never get through (as with
 * the network down): the editor shows itself offline, and changes stay unsent.
 */
export async function cutLiveConnections(page: Page) {
  await page.routeWebSocket(/\/api\/v1\/diagrams\/[^/]+\/live$/, () => {});
}

/** Undo/redo run through a queue (a level switch fades), so wait until history and animations stop changing. */
export async function drained(page: Page) {
  let last: string | null = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const now = await page.evaluate(() =>
      JSON.stringify([
        window.__nestboard!.diagramStore.temporal.getState().pastStates.length,
        document.querySelector("[data-canvas-stage]")!.getAnimations().length,
      ]),
    );
    if (now === last && now.endsWith(",0]")) return;
    last = now;
  }
}

export async function enter(page: Page, name: string) {
  await nodeNamed(page, name).dblclick();
  await settled(page);
}

export async function goBack(page: Page) {
  await page.keyboard.press("Escape");
  await settled(page);
}

export async function undo(page: Page) {
  await page.keyboard.press("Control+z");
  await drained(page);
}

export async function redo(page: Page) {
  await page.keyboard.press("Control+y");
  await drained(page);
}

// ---- Files through the plain browser fallback (no File System Access API) ----

/** Makes the page save by download and open by file chooser. Call before `openApp`. */
export async function useFileFallback(page: Page) {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });
}

/** File › Import from file…, once what was on its way has arrived, then picks `path` in the file chooser. */
export async function openFileViaChooser(page: Page, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.waitForFunction(() => !window.__nestboard!.documentStore.getState().unsaved);
  await fileMenu(page, "Import from file…");
  await (await chooser).setFiles(path);
  await page.waitForTimeout(300);
}

/** File › Export to file…, returning the downloaded file's parsed JSON. */
export async function saveViaDownload(page: Page): Promise<DiagramFile> {
  const [download] = await Promise.all([page.waitForEvent("download"), fileMenu(page, "Export to file…")]);
  return JSON.parse(readFileSync((await download.path())!, "utf8")) as DiagramFile;
}

/** Opens the File menu (the diagram's name, top right) and picks `item`. */
export async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: /^File:/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
