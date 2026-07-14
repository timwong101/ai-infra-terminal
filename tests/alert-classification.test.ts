import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAlertCategory,
  classifyAlertImpact,
  classifyClaimImpact,
  isAlertEligibleChange,
} from "@/lib/alerts/generate";

test("classifies material AI infrastructure evidence categories", () => {
  assert.equal(classifyAlertCategory("The company added 500MW of data center power capacity."), "Capacity");
  assert.equal(classifyAlertCategory("Available liquidity depends on equipment financing and debt markets."), "Funding");
  assert.equal(classifyAlertCategory("One customer represents a concentrated share of revenue."), "Customer");
  assert.equal(classifyAlertCategory("AI cloud revenue and contracted workload demand increased."), "Demand");
  assert.equal(classifyAlertCategory("Construction delays may affect the delivery schedule."), "Execution");
});

test("maps evidence sentiment to positive and risk-oriented claims", () => {
  assert.equal(classifyAlertImpact("New capacity expanded to support strong demand", "added"), "strengthens");
  assert.equal(classifyAlertImpact("Debt constraints create adverse liquidity risk", "modified"), "weakens");
  assert.equal(classifyAlertImpact("Prior disclosure explicitly no longer applies", "explicitly_removed"), "watch");
  assert.equal(classifyClaimImpact("strengthens", false), "supports");
  assert.equal(classifyClaimImpact("weakens", true), "supports");
  assert.equal(classifyClaimImpact("strengthens", true), "weakens");
});

test("excludes language that was merely not repeated from alerts and claims", () => {
  assert.equal(isAlertEligibleChange("not_repeated"), false);
  assert.equal(isAlertEligibleChange("removed"), false);
  assert.equal(isAlertEligibleChange("new_event"), true);
  assert.equal(isAlertEligibleChange("modified"), true);
});
