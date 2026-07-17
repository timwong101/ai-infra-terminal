import { expect, test } from "@playwright/test";

const companies = [
  { id: "coreweave", name: "CoreWeave" },
  { id: "nebius", name: "Nebius" },
  { id: "applied-digital", name: "Applied Digital" },
  { id: "iren", name: "IREN" },
] as const;

test.describe.serial("evidence-grounded analyst journey", () => {
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
});
