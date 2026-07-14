import assert from "node:assert/strict";
import test from "node:test";
import { isResearchGradeExcerpt, isResearchGradeSecPassage } from "@/lib/research/evidence";

test("excludes filing signatures and exhibit boilerplate from research evidence", () => {
  assert.equal(isResearchGradeExcerpt("Pursuant to the requirements of the Securities Exchange Act of 1934, the registrant has duly caused this report to be signed on its behalf by the undersigned, thereunto duly authorized."), false);
  assert.equal(isResearchGradeExcerpt("Furnished as Exhibit 99.1 to this Report on Form 6-K is a press release of the company dated June 16, 2026 announcing an acquisition."), false);
});

test("keeps substantive infrastructure disclosures", () => {
  assert.equal(isResearchGradeExcerpt("The company expects to energize 250 megawatts of data center capacity during 2026, supported by contracted utility power and phased construction milestones across two campuses."), true);
});

test("excludes filing cover-page passages even when they are long enough", () => {
  assert.equal(isResearchGradeSecPassage("Indicate the number of outstanding shares of each of the issuer's classes of capital or common stock as of the close of the period covered by the Annual Report.", "Filing Overview", "Annual report cover"), false);
  assert.equal(isResearchGradeSecPassage("Securities for which there is a reporting obligation pursuant to Section 15(d) of the Act. Class A Ordinary Shares are registered for trading.", "Company developments", "Filing Overview"), false);
});
