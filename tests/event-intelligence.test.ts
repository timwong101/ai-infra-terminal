import assert from "node:assert/strict";
import test from "node:test";
import { classifyLiveEvent, normalizeEventUrl } from "@/lib/events/classify";

test("official capacity events receive strong materiality and credibility scores", () => {
  const result = classifyLiveEvent(
    "CoreWeave signed a $2 billion contract for 250 MW of new GPU data center capacity.",
    "official-ir",
    92,
  );
  assert.equal(result.eventType, "Capacity");
  assert.equal(result.claimKind, "capacity-growth");
  assert.equal(result.claimImpact, "supports");
  assert.ok(result.materialityScore >= 82);
  assert.equal(result.credibilityScore, 92);
});

test("funding risk events map to the risk thesis without becoming evidence", () => {
  const result = classifyLiveEvent(
    "The company warned that debt and liquidity constraints could delay construction.",
    "gdelt",
    55,
  );
  assert.equal(result.claimKind, "funding-risk");
  assert.equal(result.claimImpact, "supports");
  assert.ok(result.credibilityScore < 80);
});

test("event URL normalization removes tracking parameters but preserves the source", () => {
  assert.equal(
    normalizeEventUrl("https://example.com/story?utm_source=newsletter&id=42#section"),
    "https://example.com/story?id=42",
  );
});

