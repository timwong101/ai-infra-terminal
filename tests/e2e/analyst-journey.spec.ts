import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";

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

async function createViewerSession() {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = new Client({ connectionString: e2eDatabaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO users (id, email, name, provider, provider_account_id) VALUES ('user:e2e-viewer', 'viewer@example.com', 'Read Only Reviewer', 'test', 'viewer') ON CONFLICT (id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('membership:e2e-viewer', 'workspace:demo', 'user:e2e-viewer', 'viewer') ON CONFLICT (id) DO NOTHING",
    );
    await client.query(
      "INSERT INTO auth_sessions (id, token_hash, user_id, active_workspace_id, expires_at) VALUES ($1, $2, 'user:e2e-viewer', 'workspace:demo', now() + interval '1 hour')",
      [`session:${randomUUID()}`, tokenHash],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  return token;
}

const companies = [
  { id: "coreweave", name: "CoreWeave" },
  { id: "nebius", name: "Nebius" },
  { id: "applied-digital", name: "Applied Digital" },
  { id: "iren", name: "IREN" },
] as const;

test.describe.serial("evidence-grounded analyst journey", () => {
  test.beforeAll(() => prepareTestDatabase());

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("button", { name: /Open portfolio demo/ }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "AI Infrastructure Map" })).toBeVisible();
  });

  test("navigation groups tools around the analyst workflow", async ({ page }) => {
    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(primaryNavigation.getByRole("button")).toHaveCount(5);
    await expect(primaryNavigation.getByRole("button", { name: "Overview Market map", exact: true })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: /^Monitor Signals and alerts/ })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Research Evidence and claims", exact: true })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Analysis Ask and publish", exact: true })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "System Pipeline and controls", exact: true })).toBeVisible();

    await primaryNavigation.getByRole("button", { name: "Research Evidence and claims", exact: true }).click();
    await expect(page).toHaveURL(/\/companies$/);
    const researchTools = page.getByRole("navigation", { name: "Research tools" });
    await expect(researchTools.getByRole("button")).toHaveCount(4);
    await researchTools.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page).toHaveURL(/\/evidence$/);
    await expect(page.getByRole("heading", { name: "Evidence Review" })).toBeVisible();

    await page.goto("/research-quality");
    const systemTools = page.getByRole("navigation", { name: "System tools" });
    await expect(systemTools.getByRole("button")).toHaveCount(3);
    await expect(systemTools.getByRole("button", { name: "Quality", exact: true })).toHaveClass(/active/);

    for (const section of [
      { route: "/alerts", label: "Monitor" },
      { route: "/companies", label: "Research" },
      { route: "/research-assistant", label: "Analysis" },
      { route: "/activity", label: "System" },
    ]) {
      await page.goto(section.route);
      const toolNavigation = page.getByRole("navigation", { name: `${section.label} tools` });
      await expect(toolNavigation.getByText(section.label, { exact: true })).toHaveCount(0);
    }
  });

  test("core workspaces stay inside the mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/home", "/evidence", "/alerts", "/research-assistant", "/lineage"]) {
      await page.goto(route);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await expect(page.getByRole("navigation", { name: "Research tools" })).toBeVisible();
  });

  test("the theme browser stays readable and stacked on wide screens", async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 1024 });
    await page.goto("/home");

    const themePanel = page.locator(".themes-panel");
    const researchPanel = page.locator(".research-panel");
    const themeBox = await themePanel.boundingBox();
    const researchBox = await researchPanel.boundingBox();
    expect(themeBox).not.toBeNull();
    expect(researchBox).not.toBeNull();
    expect(researchBox!.y).toBeGreaterThanOrEqual(themeBox!.y + themeBox!.height);

    const domainButtons = page.getByRole("navigation", { name: "Infrastructure domains" }).getByRole("button");
    await expect(domainButtons).toHaveCount(6);
    await domainButtons.filter({ hasText: "Power & Electrical" }).click();
    await expect(page.getByRole("region", { name: "Power & Electrical themes" })).toBeVisible();

    const themeOptions = page.locator(".theme-options button");
    await expect(themeOptions).toHaveCount(4);
    for (const option of await themeOptions.all()) {
      const box = await option.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(200);
    }
  });

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

  test("viewer sessions can inspect research but cannot mutate it", async ({ context, page }) => {
    const token = await createViewerSession();
    await context.addCookies([{ name: "ai_infra_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);

    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "Comparison Memos" })).toBeVisible();
    const response = await page.request.post("/api/comparison-memos", { data: { companyAId: "coreweave", companyBId: "nebius", topic: "All topics", question: "Viewer mutation check" } });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "The analyst role is required for this action." });
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

    const answerHeadings = page.getByRole("heading", { name: "Evidence-backed answer" });
    await expect(answerHeadings).toHaveCount(1);
    await expect(answerHeadings).toBeVisible();
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

  test("live events, temporal replay, and lineage expose one connected research workflow", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByRole("heading", { name: "Live Event Intelligence" })).toBeVisible();
    await expect(page.getByText("Discovery is not evidence", { exact: true })).toBeVisible();
    await expect(page.locator(".event-list > button")).toHaveCount(4);
    await expect(page.getByText("Official", { exact: true }).first()).toBeVisible();

    await page.goto("/research-replay");
    await expect(page.getByRole("heading", { name: "Point-in-Time Research Replay" })).toBeVisible();
    await page.getByRole("button", { name: "Publication time" }).click();
    await page.getByLabel("Replay research question").fill("What capacity evidence was available then, and what arrived later?");
    await page.locator('input[type="date"]').fill("2026-02-01");
    await page.getByRole("button", { name: "Run replay" }).click();
    await expect(page.getByText("Leakage check passed", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What changed the packet" })).toBeVisible();
    await expect(page.getByText("Durable snapshots", { exact: true })).toBeVisible();

    await page.goto("/lineage");
    await expect(page.getByRole("heading", { name: "Claim-to-Evidence Lineage" })).toBeVisible();
    await expect(page.getByLabel("Interactive evidence lineage graph")).toBeVisible();
    await page.getByRole("button", { name: "Compliance" }).click();
    await expect(page.getByText(/nodes · .* links/)).toBeVisible();
  });

  test("workspace switching isolates saved research and preserves attributed audit history", async ({ page }) => {
    await page.getByRole("button", { name: "Open profile and workspace menu" }).click();
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill("Second Analyst Workspace");
    await page.getByRole("button", { name: "Save workspace" }).click();

    await expect(page.getByRole("heading", { name: "AI Infrastructure Map" })).toBeVisible();
    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "Comparison Memos" })).toBeVisible();
    await expect(page.getByText("No memo selected", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open profile and workspace menu" }).click();
    await page.getByRole("button", { name: /Neocloud Research/ }).click();
    await expect(page.getByRole("heading", { name: "AI Infrastructure Map" })).toBeVisible();
    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
    await expect(page.getByText("Created CoreWeave vs. Nebius comparison memo.", { exact: true })).toBeVisible();
  });
});
