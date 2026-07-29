import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const workerPort = 4174;
const baseURL = `http://localhost:${port}`;
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL?.trim();
const e2eRedisUrl = process.env.E2E_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379/1";

if (!e2eDatabaseUrl) {
  throw new Error("E2E_DATABASE_URL must point to a dedicated test database before running Playwright.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm worker:research -- --health-port ${workerPort}`,
      url: `http://localhost:${workerPort}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_TEST: "1",
        E2E_DATABASE_URL: e2eDatabaseUrl,
        E2E_REDIS_URL: e2eRedisUrl,
        E2E_FAIL_STAGE_ONCE: "embedding-evidence",
        REDIS_URL: e2eRedisUrl,
        SEC_USER_AGENT: process.env.SEC_USER_AGENT || "AI Infra Terminal CI ci@example.com",
      },
    },
    {
      command: `pnpm dev -- --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_TEST: "1",
        E2E_DATABASE_URL: e2eDatabaseUrl,
        E2E_REDIS_URL: e2eRedisUrl,
        REDIS_URL: e2eRedisUrl,
        SEC_USER_AGENT: process.env.SEC_USER_AGENT || "AI Infra Terminal CI ci@example.com",
      },
    },
  ],
});
