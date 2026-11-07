import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { E2E_STATE } from "./e2e/account";

// Two runs at once (e.g. two people or agents in one checkout) must not share
// servers: give the second one its own ports, e.g. E2E_PORT=5189 E2E_API_PORT=8011,
// and its own `--output` folder.
const PORT = Number(process.env.E2E_PORT ?? 5179);
/** The backend the tests talk to: its own port, and the test database. */
const API_PORT = Number(process.env.E2E_API_PORT ?? 8001);
/** E2E_SERVER_LOGS=1 prints the test backend's request log. */
const SERVER_LOGS = Boolean(process.env.E2E_SERVER_LOGS);
const SERVER_DIR = resolve(import.meta.dirname, "../server");
const PYTHON = join(SERVER_DIR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
/**
 * Which installed browser to drive. Defaults to Microsoft Edge so no browser
 * download is needed; set E2E_CHANNEL=chrome, or E2E_CHANNEL=chromium for
 * Playwright's own build (run `npx playwright install chromium` first).
 */
const channel = process.env.E2E_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  // Each spec walks through a whole feature in one long flow.
  timeout: 90_000,
  // Checks wait up to 10 s (default 5): many pages talk to the real backend,
  // which is busier while several browsers run tests at once.
  expect: { timeout: 10_000 },
  // The specs drive animations and drag gestures; retry once on CI to absorb timing noise.
  retries: process.env.CI ? 1 : 0,
  // Signs in and prepares the e2e project once; every test starts signed in.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: E2E_STATE,
    channel: channel === "chromium" ? undefined : channel,
    viewport: { width: 1400, height: 860 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Needs the database running: `docker compose up -d db` in the repository root.
      // No access log: nothing reads this server's output, and once that pipe
      // fills up the server blocks on the next log line, hanging every request.
      // E2E_SERVER_LOGS=1 shows the log instead (and so keeps it drained).
      command:
        `"${PYTHON}" -m alembic upgrade head && "${PYTHON}" -m uvicorn app.main:app --port ${API_PORT}` +
        (SERVER_LOGS ? "" : " --no-access-log"),
      cwd: SERVER_DIR,
      env: {
        NESTBOARD_DATABASE_URL: "postgresql+asyncpg://nestboard:nestboard@localhost:5432/nestboard_test",
      },
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      stdout: SERVER_LOGS ? "pipe" : "ignore",
      reuseExistingServer: !process.env.CI,
    },
    {
      // The built app, not the dev server: the dev server serves every source
      // file separately, and with several browsers loading pages at once it
      // fell seconds behind, /api calls (which it forwards) included. Built in
      // development mode, so it behaves like `npm run dev` (React's checks, the
      // window.__nestboard test hooks); into its own folder, so `dist` is left
      // alone. `vite preview` forwards /api like the dev server does.
      command:
        `npx vite build --mode development --outDir dist-e2e --emptyOutDir --logLevel warn && ` +
        `npx vite preview --mode development --outDir dist-e2e --port ${PORT} --strictPort`,
      // 127.0.0.1, not "localhost": see the proxy note in vite.config.ts.
      // NODE_ENV=development makes the build a development build
      // (import.meta.env.DEV); `--mode development` alone does not.
      env: { NESTBOARD_API_URL: `http://127.0.0.1:${API_PORT}`, NODE_ENV: "development" },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
