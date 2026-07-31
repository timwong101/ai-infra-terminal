import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { PORTFOLIO_ASSISTANT_QUESTION } from "@/lib/demo/portfolio-seed";

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

async function createReviewerSession() {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = new Client({ connectionString: e2eDatabaseUrl });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO auth_sessions (id, token_hash, user_id, active_workspace_id, expires_at) VALUES ($1, $2, 'user:demo-reviewer', 'workspace:demo', now() + interval '1 hour')",
      [`session:${randomUUID()}`, tokenHash],
    );
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

  test("portfolio demo opens with a complete, evidence-grounded analyst story", async ({ page }) => {
    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence packet" })).toBeVisible();
    await expect(page.getByText("Claim checks passed", { exact: true })).toBeVisible();
    await expect(page.getByText("Why it matters", { exact: true }).first()).toBeVisible();

    await page.goto("/research-assistant");
    await expect(page).toHaveURL(/\/research-assistant\/.+/);
    await expect(page.getByText(PORTFOLIO_ASSISTANT_QUESTION, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence-backed answer" })).toBeVisible();
    await expect(page.getByText("Claim checks")).toBeVisible();
    await expect(page.getByText("Pass", { exact: true })).toBeVisible();

    await page.goto("/research-quality");
    await expect(page).toHaveURL(/\/research-quality\/.+/);
    await expect(page.getByLabel("Quality metrics").getByText("Citation precision", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Quality metrics").getByText("Groundedness", { exact: true })).toBeVisible();

    await page.goto("/research-replay");
    await expect(page.getByText("Leakage check passed", { exact: true })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByText("Created CoreWeave vs. Nebius comparison memo.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Completed neocloud-grounding-v2 with \d+\/100\./)).toBeVisible();
    await expect(page.getByText("Replayed 2 companies as of 2026-02-01.", { exact: true })).toBeVisible();
  });

  test("publishes an immutable public report with compliance and export controls", async ({ context, page }) => {
    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();
    await page.getByRole("button", { name: "Publish report" }).click();

    const publishDialog = page.getByRole("dialog", { name: "Publish research report" });
    await expect(publishDialog).toBeVisible();
    await expect(publishDialog.getByRole("checkbox")).toBeChecked();
    await publishDialog.getByRole("button", { name: "Publish version 1" }).click();

    await expect(page.getByText("Version 1 published", { exact: true })).toBeVisible();
    const openReport = page.getByRole("link", { name: "Open report", exact: true });
    const reportPath = await openReport.getAttribute("href");
    expect(reportPath).toMatch(/^\/reports\/[a-f0-9]{64}$/);

    await context.clearCookies();
    await page.goto(reportPath!);
    await expect(page).toHaveURL(/\/reports\/[a-f0-9]{64}$/);
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius", exact: true })).toBeVisible();
    await expect(page.getByText("Compliance mode", { exact: true })).toBeVisible();
    await expect(page.getByText("Independently reviewed", { exact: true })).toBeVisible();
    await expect(page.getByText("Why it matters", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Source appendix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();

    const token = reportPath!.split("/").at(-1);
    const markdown = await page.request.get(`/api/reports/${token}/markdown`);
    expect(markdown.status()).toBe(200);
    expect(markdown.headers()["content-type"]).toContain("text/markdown");
    expect(await markdown.text()).toContain("# CoreWeave vs. Nebius");
  });

  test("core workspaces stay inside the mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/home", "/evidence", "/alerts", "/research-assistant", "/lineage", "/activity"]) {
      await page.goto(route);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await expect(page.getByRole("navigation", { name: "System tools" })).toBeVisible();
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

    await page.getByRole("button", { name: "Peer benchmark" }).click();
    await expect(page.getByRole("heading", { name: "Neocloud peer matrix" })).toBeVisible();
    await expect(page.locator(".metric-matrix thead th")).toHaveCount(5);
    await expect(page.getByText("Canonical facts", { exact: true })).toBeVisible();
    const firstMetric = page.locator(".metric-matrix-value").first();
    await expect(firstMetric).toBeVisible();
    await firstMetric.click();
    await expect(page.getByRole("heading", { name: "Observation review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make canonical" })).toBeVisible();

    await page.goto("/activity");
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { name: "Activity & Briefings" })).toBeVisible();
  });

  test("tracks management commitments from accepted evidence through a reviewed outcome", async ({ page }) => {
    for (const company of companies) {
      const response = await page.request.get(`/api/commitments?company=${company.id}`);
      expect(response.status()).toBe(200);
      const ledger = await response.json() as { company: { id: string }; commitments: Array<{ id: string }> };
      expect(ledger.company.id).toBe(company.id);
      expect(ledger.commitments.length).toBeGreaterThan(0);
    }

    await page.goto("/companies/coreweave");
    await page.getByRole("button", { name: "Commitments", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Guidance & Commitments" })).toBeVisible();
    await expect(page.getByText("300 MW", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Target 2027-12-31", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Analyst confirmation required", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Accept commitment" }).click();
    await expect(page.getByText("Analyst confirmation required", { exact: true })).toHaveCount(0);

    const metricResponse = await page.request.get("/api/company-metrics");
    expect(metricResponse.status()).toBe(200);
    const metricLedger = await metricResponse.json() as { observations: Array<{ id: string; companyId: string; metricKey: string; normalizedValue: number; documentDate: string }> };
    const deliveredCapacity = metricLedger.observations.find((item) =>
      item.companyId === "coreweave"
      && item.metricKey === "active_power_capacity"
      && item.normalizedValue === 320
      && item.documentDate === "2027-12-31",
    );
    expect(deliveredCapacity).toBeDefined();
    const metricReview = await page.request.patch("/api/company-metrics", {
      data: { id: deliveredCapacity!.id, status: "accepted", note: "Verified year-end delivered capacity for commitment reconciliation." },
    });
    expect(metricReview.status()).toBe(200);

    await page.getByRole("button", { name: "Scan accepted evidence" }).click();
    await expect(page.getByText("Latest compatible canonical actual", { exact: true })).toBeVisible();
    await expect(page.getByText("320 MW", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: "Reconcile actual" }).click();
    await expect(page.getByText("achieved · 320 MW", { exact: true })).toBeVisible();
    await expect(page.getByText(/320 MW reported for 2027-12-31 versus 300 MW committed \(\+7%\)/)).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByText("Accepted Planned or secured power commitment.", { exact: true })).toBeVisible();
    await expect(page.getByText("Reconciled Planned or secured power as achieved using 320 MW.", { exact: true })).toBeVisible();
  });

  test("archives exact source bytes and previews parser replay without rewriting accepted evidence", async ({ page }) => {
    await page.goto("/evidence?company=coreweave");
    await expect(page.getByRole("heading", { name: "Evidence Review" })).toBeVisible();
    await page.getByLabel("Filter evidence triage").selectOption("all");
    const archivedRow = page.locator('[data-evidence-id="e2e:coreweave:capacity"]');
    await expect(archivedRow).toBeVisible();
    await archivedRow.click();

    const provenance = page.getByRole("region", { name: "Immutable source provenance" });
    await expect(provenance).toBeVisible();
    await expect(provenance.getByText("Artifact provenance", { exact: true })).toBeVisible();
    await expect(provenance.getByText("ir-html-v1", { exact: true })).toBeVisible();

    const download = await page.request.get("/api/source-artifacts?source=ir&document=e2e-document%3Acoreweave%3Acapacity&action=download");
    expect(download.status(), await download.text()).toBe(200);
    expect(download.headers()["x-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);

    await provenance.getByRole("button", { name: "Reprocess" }).click();
    await expect(provenance.getByText("Isolated parser preview", { exact: true })).toBeVisible();
    await expect(provenance.getByText("Canonical evidence is unchanged until this preview is promoted.", { exact: true })).toBeVisible();

    const evidenceResponse = await page.request.get("/api/research-evidence?sync=0");
    const evidence = await evidenceResponse.json() as { items: Array<{ id: string; reviewStatus: string }> };
    expect(evidence.items.find((item) => item.id === "e2e:coreweave:capacity")?.reviewStatus).toBe("accepted");

    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Source archive" })).toBeVisible();
    await expect(page.getByText("document coverage", { exact: true })).toBeVisible();
    await expect(page.locator(".source-archive-health dd").last()).toHaveText(/filesystem|s3/);
  });

  test("durable research jobs retry, stream progress, and replay from the control plane", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByText("Redis connected", { exact: true })).toBeVisible();
    await expect(page.locator(".worker-state.online")).toHaveCount(2);

    await page.getByRole("button", { name: "Run cycle" }).click();
    const latestRun = page.locator(".run-history > button").first();
    await expect(latestRun).toContainText("dashboard");
    await expect(latestRun.getByText("completed", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".run-progress").getByText("100%", { exact: true })).toBeVisible();
    await expect(page.getByText("Attempt 2 of 3", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Replay" }).click();
    const replayedRun = page.locator(".run-history > button").first();
    await expect(replayedRun).toContainText("replay:cycle");
    await expect(replayedRun.getByText("completed", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".run-progress").getByText("100%", { exact: true })).toBeVisible();
  });

  test("viewer sessions can inspect research but cannot mutate it", async ({ context, page }) => {
    const token = await createViewerSession();
    await context.addCookies([{ name: "ai_infra_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);

    await page.goto("/memos");
    await expect(page.getByRole("heading", { name: "Comparison Memos" })).toBeVisible();
    const response = await page.request.post("/api/comparison-memos", { data: { companyAId: "coreweave", companyBId: "nebius", topic: "All topics", question: "Viewer mutation check" } });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "The analyst role is required for this action." });
    const publishResponse = await page.request.post("/api/published-reports", { data: { memoId: "memo:not-allowed", complianceMode: true } });
    expect(publishResponse.status()).toBe(403);
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
    await expect(page.getByText("Claim checks passed", { exact: true })).toBeVisible();
    await expect(page.getByText("Why it matters", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence packet" })).toBeVisible();
    await expect(page.getByLabel("Open citation 1")).toBeVisible();

    const memoUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(memoUrl);
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();
  });

  test("routes a memo through claim comments, independent approval, and publish readiness", async ({ browser, page }) => {
    await page.goto("/memos");
    await page.getByLabel("Company A").selectOption("applied-digital");
    await page.getByLabel("Company B").selectOption("iren");
    await page.getByLabel("Research question").fill("Compare Applied Digital and IREN with an independent review gate.");
    await page.getByRole("button", { name: "Generate grounded memo" }).click();
    await expect(page).toHaveURL(/\/memos\/.+/);
    await page.getByRole("button", { name: "Submit for review" }).click();

    const submitDialog = page.getByRole("dialog", { name: "Submit memo for review" });
    await expect(submitDialog.getByLabel("Memo reviewer")).toContainText("Demo Reviewer");
    await submitDialog.getByLabel("Review submission note").fill("Check the financing comparison and source attribution.");
    await submitDialog.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();

    await page.getByLabel("Review comment target").selectOption({ index: 1 });
    await page.getByLabel("Review comment", { exact: true }).fill("Confirm that this claim remains within the cited issuer disclosure.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("Confirm that this claim remains within the cited issuer disclosure.", { exact: true })).toBeVisible();

    const reviewerToken = await createReviewerSession();
    const reviewerContext = await browser.newContext();
    await reviewerContext.addCookies([{ name: "ai_infra_session", value: reviewerToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const reviewerPage = await reviewerContext.newPage();
    await reviewerPage.goto(page.url());
    await expect(reviewerPage.getByText("In review", { exact: true })).toBeVisible();
    await reviewerPage.getByRole("button", { name: "Resolve review comment" }).click();
    await reviewerPage.getByLabel("Review decision note").fill("Evidence packet and company attribution verified.");
    await reviewerPage.getByRole("button", { name: "Approve memo" }).click();
    await expect(reviewerPage.getByText("Approved", { exact: true })).toBeVisible();
    await reviewerContext.close();

    await page.reload();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish report" })).toBeVisible();
  });

  test("workspace menu exposes real team membership and role management", async ({ page }) => {
    await page.getByRole("button", { name: "Open profile and workspace menu" }).click();
    await page.getByRole("button", { name: "Manage team" }).click();
    const dialog = page.getByRole("dialog", { name: "Workspace team" });
    await expect(dialog.getByText("Demo Analyst (you)", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Demo Reviewer", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Role for Demo Reviewer")).toHaveValue("analyst");
  });

  test("research assistant streams, verifies, and persists a cited research answer", async ({ page }) => {
    await page.goto("/research-assistant");
    await expect(page).toHaveURL(/\/research-assistant\/.+/);
    await expect(page.getByRole("heading", { name: "Research Assistant" })).toBeVisible();

    await page.getByRole("textbox", { name: "Research question" }).fill("Compare the selected Neoclouds on capacity, demand, and financing risk.");
    await page.getByRole("button", { name: "Send question" }).click();

    const savedAnswer = page.locator(".saved-answer").filter({ hasText: "Compare the selected Neoclouds on capacity, demand, and financing risk." });
    await expect(savedAnswer).toHaveCount(1);
    await expect(savedAnswer.getByRole("heading", { name: "Evidence-backed answer" })).toBeVisible();
    await expect(savedAnswer.getByText("Claim checks")).toBeVisible();
    await expect(savedAnswer.getByText("Pass", { exact: true })).toBeVisible();
    await expect(savedAnswer.getByText("Evidence packet")).toBeVisible();

    const sessionUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(sessionUrl);
    const reloadedAnswer = page.locator(".saved-answer").filter({ hasText: "Compare the selected Neoclouds on capacity, demand, and financing risk." });
    await expect(reloadedAnswer.getByText("Compare the selected Neoclouds on capacity, demand, and financing risk.", { exact: true })).toBeVisible();
    await expect(reloadedAnswer.getByRole("heading", { name: "Evidence-backed answer" })).toBeVisible();
  });

  test("analyst feedback becomes an executable production regression case", async ({ page }) => {
    const question = "Compare the selected Neoclouds on capacity, demand, and financing risk.";
    await page.goto("/research-assistant");
    const savedAnswer = page.locator(".saved-answer").filter({ hasText: question });
    await savedAnswer.getByRole("button", { name: "Report issue" }).click();
    await savedAnswer.getByRole("combobox", { name: "Failure type" }).selectOption("wrong-retrieval");
    await savedAnswer.getByRole("combobox", { name: "Severity" }).selectOption("high");
    await savedAnswer.getByRole("textbox", { name: "What failed?" }).fill("The answer should have been limited to the requested CoreWeave scope.");
    await savedAnswer.getByRole("textbox", { name: "Expected behavior optional" }).fill("Return only CoreWeave evidence and exclude unrelated company claims.");
    await savedAnswer.getByRole("button", { name: "Submit issue" }).click();
    await expect(savedAnswer.getByText("Issue captured", { exact: false })).toBeVisible();

    await page.goto("/research-quality");
    await page.getByRole("button", { name: /Failure queue · 1/ }).click();
    await expect(page.getByRole("heading", { name: "Failure Queue" })).toBeVisible();
    await page.getByRole("checkbox", { name: "APLD Applied Digital" }).uncheck();
    await page.getByRole("checkbox", { name: "IREN IREN" }).uncheck();
    await page.getByRole("checkbox", { name: "NBIS Nebius" }).uncheck();
    await page.getByRole("button", { name: "Promote to regression" }).click();
    await expect(page.getByText("Regression case created and added to future quality runs.")).toBeVisible();
    await expect(page.getByText("answer · 1 minimum citations", { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Failure queue" }).click();
    await expect(page.getByRole("checkbox", { name: "CRWV CoreWeave" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "APLD Applied Digital" })).not.toBeChecked();
    await expect(page.getByText("version 1", { exact: false })).toBeVisible();
    await page.getByRole("textbox", { name: "Expected behavior" }).fill("Return only accepted CoreWeave evidence with at least one same-company citation.");
    await page.getByRole("button", { name: "Create new version" }).click();
    await expect(page.getByText("A new case version was created without rewriting prior benchmark history.")).toBeVisible();
    await expect(page.getByText("version 2", { exact: false })).toBeVisible();
  });

  test("research quality runs a durable grounding benchmark and exposes case evidence", async ({ page }) => {
    await page.goto("/research-quality");
    await expect(page.getByRole("heading", { name: "Research Quality" })).toBeVisible();
    await page.getByRole("button", { name: "Run benchmark" }).click();

    await expect(page).toHaveURL(/\/research-quality\/.+/, { timeout: 30_000 });
    await expect(page.getByText("33/33 passed", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Quality metrics").getByText("Citation precision", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Quality metrics").getByText("Groundedness", { exact: true })).toBeVisible();
    await expect(page.getByText("Evidence packet")).toBeVisible();

    const runUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(runUrl);
    await expect(page.getByText("33/33 passed", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Metric contracts" }).click();
    await page.getByRole("button", { name: "Run metric benchmark" }).click();
    await expect(page.getByText("11 pass · 0 fail", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Metric quality metrics").getByText("Anomaly safety", { exact: true })).toBeVisible();
    await expect(page.getByText("Live metric data contracts", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Source extraction" }).click();
    await expect(page.getByRole("heading", { name: "Real-Document Extraction Lab" })).toBeVisible();
    await page.getByRole("button", { name: "Run source benchmark" }).click();
    await expect(page.getByText("1 pass · 0 fail", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Source extraction metrics").getByText("False-positive safety", { exact: true })).toBeVisible();
    await expect(page.getByText("Archived SHA-256", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Promote parser" }).click();
    await expect(page.getByText("source-extraction-v2 promoted from the passing source benchmark.", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: /CoreWeave vs\. Nebius/ }).first().click();
    await expect(page.getByRole("heading", { name: "CoreWeave vs. Nebius" })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
    await expect(page.getByText("Created CoreWeave vs. Nebius comparison memo.", { exact: true }).first()).toBeVisible();
  });

  test("analyst promotion is audited and repeated replay cannot downgrade the canonical parser run", async ({ page }) => {
    const source = { sourceKind: "ir", sourceDocumentId: "e2e-document:coreweave:capacity" } as const;
    const query = "/api/source-artifacts?source=ir&document=e2e-document%3Acoreweave%3Acapacity";
    const provenanceResponse = await page.request.get(query);
    expect(provenanceResponse.status()).toBe(200);
    const provenance = await provenanceResponse.json() as { previews: Array<{ id: string }> };
    if (!provenance.previews.length) {
      const previewResponse = await page.request.post("/api/source-artifacts", {
        data: { action: "reprocess", ...source },
      });
      expect(previewResponse.status()).toBe(200);
      const previewed = await previewResponse.json() as { previews: Array<{ id: string }> };
      provenance.previews = previewed.previews;
    }
    expect(provenance.previews).toHaveLength(1);

    const promotedResponse = await page.request.post("/api/source-artifacts", {
      data: { action: "promote", runId: provenance.previews[0].id },
    });
    const promoted = await promotedResponse.json() as { currentExtraction: { id: string }; previews: Array<unknown> };
    expect(promotedResponse.status(), JSON.stringify(promoted)).toBe(200);
    expect(promoted.currentExtraction.id).toBe(provenance.previews[0].id);
    expect(promoted.previews).toHaveLength(0);

    const repeatedReplay = await page.request.post("/api/source-artifacts", {
      data: { action: "reprocess", ...source },
    });
    const replayed = await repeatedReplay.json() as { currentExtraction: { id: string }; previews: Array<unknown> };
    expect(repeatedReplay.status(), JSON.stringify(replayed)).toBe(200);
    expect(replayed.currentExtraction.id).toBe(provenance.previews[0].id);
    expect(replayed.previews).toHaveLength(0);

    await page.goto("/audit");
    await expect(page.getByText("Promoted reviewed ir-html-v1 extraction into canonical evidence.", { exact: true })).toBeVisible();
  });
});
