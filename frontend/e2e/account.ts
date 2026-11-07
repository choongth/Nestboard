import { join } from "node:path";

/** The account, organization and project the end-to-end tests work in. */
export const E2E_ACCOUNT = {
  email: "e2e@example.com",
  password: "e2e password",
  displayName: "E2E",
  org: "E2E",
  project: "E2E project",
};

/** Written by global-setup.ts: the signed-in session, and the project's and organization's ids. */
export const E2E_STATE = join(import.meta.dirname, ".auth", "state.json");
export const E2E_PROJECT_FILE = join(import.meta.dirname, ".auth", "project.json");
