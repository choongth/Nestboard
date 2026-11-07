import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { E2E_ACCOUNT, E2E_PROJECT_FILE, E2E_STATE } from "./account";

/**
 * Before any test: signs in to the test backend (setting it up on first run)
 * and makes sure the e2e organization and project exist. Every test starts
 * signed in, from the session saved here, working in that project.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const api = await request.newContext({ baseURL });
  const { email, password, displayName, org: orgName, project: projectName } = E2E_ACCOUNT;

  const status = (await (await api.get("/api/v1/auth/status")).json()) as { needs_setup: boolean };
  const signIn = status.needs_setup
    ? await api.post("/api/v1/auth/setup", { data: { email, display_name: displayName, password } })
    : await api.post("/api/v1/auth/login", { data: { email, password } });
  if (!signIn.ok()) {
    throw new Error(
      `Couldn't sign in to the test backend (${signIn.status()}): nestboard_test already has other ` +
        "accounts. The backend tests empty it when they finish: run them, or empty it by hand.",
    );
  }

  type Named = { id: string; name: string };
  const orgs = (await (await api.get("/api/v1/orgs")).json()) as Named[];
  const org =
    orgs.find((o) => o.name === orgName) ??
    ((await (await api.post("/api/v1/orgs", { data: { name: orgName } })).json()) as Named);

  const projects = (await (await api.get(`/api/v1/orgs/${org.id}/projects`)).json()) as Named[];
  const project =
    projects.find((p) => p.name === projectName) ??
    ((await (await api.post(`/api/v1/orgs/${org.id}/projects`, { data: { name: projectName } })).json()) as Named);

  // A diagram goes to the server with its first change, so every run leaves
  // dozens: start each run without the last one's.
  for (;;) {
    const page = (await (await api.get(`/api/v1/projects/${project.id}/diagrams?limit=200`)).json()) as { items: Named[] };
    if (page.items.length === 0) break;
    await Promise.all(page.items.map((d) => api.delete(`/api/v1/diagrams/${d.id}`)));
  }

  mkdirSync(dirname(E2E_STATE), { recursive: true });
  writeFileSync(E2E_PROJECT_FILE, JSON.stringify({ id: project.id, orgId: org.id }));
  await api.storageState({ path: E2E_STATE });
  await api.dispose();
}
