import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const baseURL = `http://localhost:${port}`;
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL?.trim();

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
  webServer: {
    command: `pnpm dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_TEST: "1",
      E2E_DATABASE_URL: e2eDatabaseUrl,
      SEC_USER_AGENT: process.env.SEC_USER_AGENT || "AI Infra Terminal CI ci@example.com",
    },
  },
});
