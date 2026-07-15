import assert from "node:assert/strict";
import test from "node:test";
import { isResearchGradeExcerpt, isResearchGradeSecPassage, selectBaselineEvidenceCandidates } from "@/lib/research/evidence";

test("excludes filing signatures and exhibit boilerplate from research evidence", () => {
  assert.equal(isResearchGradeExcerpt("Pursuant to the requirements of the Securities Exchange Act of 1934, the registrant has duly caused this report to be signed on its behalf by the undersigned, thereunto duly authorized."), false);
  assert.equal(isResearchGradeExcerpt("Furnished as Exhibit 99.1 to this Report on Form 6-K is a press release of the company dated June 16, 2026 announcing an acquisition."), false);
  assert.equal(isResearchGradeExcerpt("10.2* Incremental Assumption Agreement No. 1, dated as of June 26, 2026, by and among the company, subsidiary guarantors, lenders, and the issuing bank party thereto."), false);
  assert.equal(isResearchGradeExcerpt("10.1** Credit Agreement, dated as of May 29, 2026, by and between the company, the lenders party thereto, and the administrative agent for the secured facility."), false);
  assert.equal(isResearchGradeExcerpt("Form of certificates representing the 1.00% Convertible Senior Notes due 2033, included as Exhibit A to the indenture and delivered to the trustee."), false);
  assert.equal(isResearchGradeExcerpt("4.1= Indenture, dated as of May 14, 2026, between IREN Limited and U.S. Bank Trust Company, National Association, as trustee."), false);
  assert.equal(isResearchGradeExcerpt("A copy of the purchase agreement will be filed as an exhibit to the Company's annual report on Form 10-K for the year ending June 30, 2026."), false);
  assert.equal(isResearchGradeExcerpt("The company posted an updated investor presentation to its website. A copy of the company's updated investor presentation is attached as Exhibit 99.2 and incorporated into this report."), false);
  assert.equal(isResearchGradeExcerpt("This Current Report on Form 8-K shall not constitute an offer to sell or the solicitation of an offer to buy the preferred stock or common stock issuable upon conversion."), false);
  assert.equal(isResearchGradeExcerpt("This Current Report shall not constitute an offer to sell or the solicitation of any offer to buy the preferred stock or the common stock issuable upon conversion in any jurisdiction."), false);
  assert.equal(isResearchGradeExcerpt("The offer and sale of the preferred stock and conversion shares is and will be made in reliance upon the exemption from registration provided by Section 4(a)(2) of the Securities Act."), false);
  assert.equal(isResearchGradeExcerpt("The purchase agreement contains customary representations, warranties, covenants, indemnities and termination rights. The company has agreed to guarantee the obligations of its subsidiary under the agreement."), false);
  assert.equal(isResearchGradeExcerpt("Indenture, dated as of May 14, 2026, between IREN Limited and U.S. Bank Trust Company, National Association, as trustee for the holders of the notes issued thereunder."), false);
  assert.equal(isResearchGradeExcerpt("This Quarterly Report contains forward-looking statements within the meaning of Section 27A of the Securities Act and Section 21E of the Exchange Act."), false);
  assert.equal(isResearchGradeExcerpt("This Current Report contains “forward-looking statements” within the meaning of Section 27A of the Securities Act that involve substantial risks and uncertainties and describe expected trends."), false);
  assert.equal(isResearchGradeExcerpt("The following table summarizes our results of operation, disclosed in the unaudited condensed consolidated statements for the three and nine months ended March 31, 2026 and 2025."), false);
});

test("keeps substantive infrastructure disclosures", () => {
  assert.equal(isResearchGradeExcerpt("The company expects to energize 250 megawatts of data center capacity during 2026, supported by contracted utility power and phased construction milestones across two campuses."), true);
});

test("excludes filing cover-page passages even when they are long enough", () => {
  assert.equal(isResearchGradeSecPassage("Indicate the number of outstanding shares of each of the issuer's classes of capital or common stock as of the close of the period covered by the Annual Report.", "Filing Overview", "Annual report cover"), false);
  assert.equal(isResearchGradeSecPassage("Securities for which there is a reporting obligation pursuant to Section 15(d) of the Act. Class A Ordinary Shares are registered for trading.", "Company developments", "Filing Overview"), false);
});

test("selects a diverse official baseline without overriding review decisions", () => {
  const candidates = [
    { id: "capacity", sourceDocumentId: "quarterly", topic: "Power & capacity", sourceQuality: 95, documentDate: "2026-05-01", reviewStatus: "unreviewed" as const },
    { id: "funding", sourceDocumentId: "financing", topic: "Financing & liquidity", sourceQuality: 95, documentDate: "2026-04-01", reviewStatus: "unreviewed" as const },
    { id: "demand", sourceDocumentId: "results", topic: "Customers & demand", sourceQuality: 92, documentDate: "2026-03-01", reviewStatus: "unreviewed" as const },
    { id: "rejected", sourceDocumentId: "rejected", topic: "Risk factors", sourceQuality: 100, documentDate: "2026-06-01", reviewStatus: "rejected" as const },
  ];
  assert.deepEqual(selectBaselineEvidenceCandidates(candidates).map((item) => item.id), ["capacity", "funding", "demand"]);
  assert.equal(selectBaselineEvidenceCandidates([{ ...candidates[0], reviewStatus: "accepted" }, { ...candidates[1], reviewStatus: "accepted" }, { ...candidates[2], reviewStatus: "accepted" }]).length, 0);
});
