import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) throw new Error("E2E_DATABASE_URL is required for analyst journey tests.");

function prepareTestDatabase() {
  const env = {
    ...process.env,
    DATABASE_URL: e2eDatabaseUrl,
    E2E_DATABASE_URL: e2eDatabaseUrl,
    E2E_TEST: "1",
  };
  for (const script of ["db:migrate", "db:seed:e2e", "research:intelligence"]) {
    execFileSync("pnpm", [script], { env, stdio: "inherit" });
  }
}

const companies = [
  { id: "coreweave", name: "CoreWeave" },
  { id: "nebius", name: "Nebius" },
  { id: "applied-digital", name: "Applied Digital" },
  { id: "iren", name: "IREN" },
] as const;

test.describe.serial("evidence-grounded analyst journey", () => {
  test.beforeAll(() => prepareTestDatabase());

  test("theme and company deep links expose all four Neoclouds", async ({ page }) => {
    await page.goto("/themes/neoclouds");
    await expect(page.getByRole("heading", { name: "AI Infrastructure Map" })).toBeVisible();
    await expect(page.getByText("4 / 4", { exact: true })).toBeVisible();

    for (const company of companies) {
      await page.goto(`/companies/${company.id}`);
      await expect(page).toHaveURL(new RegExp(`/companies/${company.id}$`));
      await expect(page.getByRole("heading", { name: "Company Intelligence" })).toBeVisible();
      await expect(page.getByRole("heading", { name: company.name, exact: true })).toBeVisible();
    }

    await page.goto("/activity");
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { name: "Activity & Briefings" })).toBeVisible();
  });

  test("reviewed evidence updates research and generates a reloadable cited memo", async ({ page }) => {
    await page.goto("/evidence?company=coreweave");
    await expect(page.getByRole("heading", { name: "Evidence Review" })).toBeVisible();
    await expect(page.getByLabel("Filter by company")).toHaveValue("coreweave");

    const reviewRow = page.locator('[data-evidence-id="e2e:coreweave:review"]');
    await expect(reviewRow).toContainText("deployed 10,000 current-generation GPUs");
    await reviewRow.click();
    await page.getByRole("button", { name: "Accept + link" }).click();
    await expect(reviewRow).toHaveCount(0);

    await page.goto("/theses");
    await expect(page.getByRole("heading", { name: "Theses" })).toBeVisible();
    await expect(page.getByText("Capacity growth", { exact: true }).first()).toBeVisible();

    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Thesis Alerts" })).toBeVisible();
    await page.getByLabel("Filter significance").selectOption("all");
    await expect(page.getByRole("heading", { name: "Capacity growth supports" })).toBeVisible();
    await expect(page.locator(".alert-meta").getByText("CoreWeave (CRWV)", { exact: true })).toBeVisible();

    await page.goto("/memos");
    await page.getByLabel("Company A").selectOption("coreweave");
    await page.getByLabel("Company B").selectOption("nebius");
    await page.getByLabel("Research question").fill("Compare CoreWeave and Nebius as AI infrastructure exposure.");
    await page.getByRole("button", { name: "Generate grounded memo" }).click();

    await expect(page).toHaveURL(/\/memos\//);
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence packet" })).toBeVisible();
    await expect(page.getByLabel("Open citation 1")).toBeVisible();

    const memoUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(memoUrl);
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();
  });

  test("research assistant streams, verifies, and persists a cited research answer", async ({ page }) => {
    await page.goto("/research-assistant");
    await expect(page).toHaveURL(/\/research-assistant\/.+/);
    await expect(page.getByRole("heading", { name: "Research Assistant" })).toBeVisible();

    await page.getByRole("textbox", { name: "Research question" }).fill("Compare the selected Neoclouds on capacity, demand, and financing risk.");
    await page.getByRole("button", { name: "Send question" }).click();

    await expect(page.getByRole("heading", { name: "Evidence-backed answer" })).toBeVisible();
    await expect(page.getByText("Claim checks")).toBeVisible();
    await expect(page.getByText("Pass", { exact: true })).toBeVisible();
    await expect(page.getByText("Evidence packet")).toBeVisible();

    const sessionUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(sessionUrl);
    await expect(page.locator(".saved-answer").getByText("Compare the selected Neoclouds on capacity, demand, and financing risk.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence-backed answer" })).toBeVisible();
  });

  test("research quality runs a durable grounding benchmark and exposes case evidence", async ({ page }) => {
    await page.goto("/research-quality");
    await expect(page.getByRole("heading", { name: "Research Quality" })).toBeVisible();
    await page.getByRole("button", { name: "Run benchmark" }).click();

    await expect(page).toHaveURL(/\/research-quality\/.+/, { timeout: 30_000 });
    await expect(page.getByText("32/32 passed", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Quality metrics").getByText("Citation precision", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Quality metrics").getByText("Groundedness", { exact: true })).toBeVisible();
    await expect(page.getByText("Evidence packet")).toBeVisible();

    const runUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(runUrl);
    await expect(page.getByText("32/32 passed", { exact: false })).toBeVisible();
  });
});
