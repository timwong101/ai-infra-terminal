import assert from "node:assert/strict";
import test from "node:test";
import { parseTerminalRoute, resolveAuthPath } from "@/app/terminal-navigation";

test("terminal routes preserve list, detail, filter, and theme deep links", () => {
  assert.deepEqual(parseTerminalRoute("/companies/coreweave"), { activeNav: "Companies", companyId: "coreweave" });
  assert.deepEqual(parseTerminalRoute("/memos/memo%3A123"), { activeNav: "Memos", memoId: "memo:123" });
  assert.deepEqual(parseTerminalRoute("/research-assistant/session%3A123"), { activeNav: "Research Assistant", researchAssistantId: "session:123" });
  assert.deepEqual(parseTerminalRoute("/research-quality/run%3A123"), { activeNav: "Research Quality", researchQualityRunId: "run:123" });
  assert.deepEqual(parseTerminalRoute("/evidence", new URLSearchParams("company=nebius")), { activeNav: "Evidence Feed", evidenceCompanyId: "nebius" });
  assert.deepEqual(parseTerminalRoute("/themes/liquid-cooling"), { activeNav: "Themes", selectedTheme: "Liquid Cooling" });
});

test("auth routing preserves safe local destinations without login loops", () => {
  assert.equal(resolveAuthPath(false, "/"), "/login");
  assert.equal(resolveAuthPath(false, "/companies/coreweave"), "/login?returnTo=%2Fcompanies%2Fcoreweave");
  assert.equal(resolveAuthPath(true, "/login", new URLSearchParams("returnTo=%2Fmemos%2Fmemo%253A123")), "/memos/memo%3A123");
  assert.equal(resolveAuthPath(true, "/login", new URLSearchParams("returnTo=https%3A%2F%2Fexample.com")), "/home");
});
