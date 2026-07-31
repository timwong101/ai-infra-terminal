import type { ExtractionBenchmarkCase } from "@/lib/extraction-quality/types";

export const EXTRACTION_QUALITY_SUITE_VERSION = "neocloud-real-source-v2";
export const EXTRACTION_PARSER_CANDIDATE = "source-extraction-v2";

const realCases: ExtractionBenchmarkCase[] = [
  {
    id: "real-source:apld:q4-fy2026-release", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "Applied Digital Q4 FY2026 earnings release", companyId: "applied-digital", sourceKind: "ir",
    sourceDocumentId: "ir:applied-digital:2026-07-27:reports-fiscal-fourth-quarter-and-full-year-2026-results",
    origin: "production-failure", severity: "critical", active: true,
    expectations: {
      minimumSections: 4, minimumPassages: 15,
      expectedTopics: ["Power", "Customers", "Financing"],
      allowedMetricKeys: ["contract_value", "debt", "liquidity", "power_capacity", "planned_power_capacity", "revenue"],
      expectedMetrics: [
        { metricKey: "revenue", value: 208.2, unit: "USD millions", tolerancePercent: 0 },
        { metricKey: "power_capacity", value: 210, unit: "MW", tolerancePercent: 0 },
      ],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: 4, periodEnd: "2026-05-31" },
    },
  },
  {
    id: "real-source:apld:july-2026-deck", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "Applied Digital infrastructure presentation", companyId: "applied-digital", sourceKind: "ir",
    sourceDocumentId: "ir:applied-digital:2026-07-27:investor-presentation",
    origin: "curated-real-source", severity: "high", active: true,
    expectations: {
      minimumSections: 4, minimumPassages: 20,
      expectedTopics: ["Capacity", "Financing"],
      allowedMetricKeys: ["contract_value", "debt", "planned_power_capacity", "power_capacity"],
      expectedMetrics: [
        { metricKey: "contract_value", value: 36_000, unit: "USD millions", tolerancePercent: 0 },
        { metricKey: "planned_power_capacity", value: 5_000, unit: "MW", tolerancePercent: 0 },
      ],
      forbiddenMetrics: [{ metricKey: "debt", value: 0.001, tolerancePercent: 10 }],
    },
  },
  {
    id: "real-source:coreweave:q1-2026-10q", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "CoreWeave Q1 2026 filing structure", companyId: "coreweave", sourceKind: "sec",
    sourceDocumentId: "sec:0001769628:0001769628-26-000222",
    origin: "curated-real-source", severity: "critical", active: true,
    expectations: {
      minimumSections: 4, minimumPassages: 15, expectedTopics: ["Overview", "Operations"],
      allowedMetricKeys: [], expectedMetrics: [],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: null, periodEnd: "2026-03-31" },
    },
  },
  {
    id: "real-source:coreweave:fy2025-10k", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "CoreWeave FY2025 filing structure", companyId: "coreweave", sourceKind: "sec",
    sourceDocumentId: "sec:0001769628:0001769628-26-000104",
    origin: "curated-real-source", severity: "high", active: true,
    expectations: {
      minimumSections: 7, minimumPassages: 20, expectedTopics: ["Business", "Risk"],
      allowedMetricKeys: [], expectedMetrics: [],
      expectedPeriod: { periodKind: "annual", fiscalYear: 2025, fiscalQuarter: null, periodEnd: "2025-12-31" },
    },
  },
  {
    id: "real-source:nebius:q1-2026-release", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "Nebius Q1 2026 earnings release", companyId: "nebius", sourceKind: "ir",
    sourceDocumentId: "ir:nebius:2026-05-13:q1-2026-earnings-release",
    origin: "curated-real-source", severity: "critical", active: true,
    expectations: {
      minimumSections: 3, minimumPassages: 8,
      expectedTopics: ["Capacity", "Financing"],
      allowedMetricKeys: ["annual_recurring_revenue", "capex", "liquidity", "planned_power_capacity", "power_capacity", "revenue"],
      expectedMetrics: [{ metricKey: "planned_power_capacity", value: 1_200, unit: "MW", tolerancePercent: 0 }],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: 1, periodEnd: "2026-03-31" },
    },
  },
  {
    id: "real-source:nebius:q4-2025-letter", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "Nebius Q4 2025 shareholder letter", companyId: "nebius", sourceKind: "ir",
    sourceDocumentId: "ir:nebius:2026-02-12:q4-fy-2025-letter-to-shareholders",
    origin: "curated-real-source", severity: "critical", active: true,
    expectations: {
      minimumSections: 3, minimumPassages: 15,
      expectedTopics: ["Capacity", "Customers", "Financing"],
      allowedMetricKeys: ["active_power_capacity", "annual_recurring_revenue", "capex", "liquidity", "operating_cash_flow", "planned_power_capacity", "power_capacity", "revenue"],
      expectedMetrics: [{ metricKey: "active_power_capacity", value: 170, unit: "MW", tolerancePercent: 0 }],
      expectedCommitmentKeys: ["active_power_capacity:company:company-total"],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: 4, periodEnd: "2025-12-31" },
    },
  },
  {
    id: "real-source:iren:q3-fy2026-10q", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "IREN Q3 FY2026 filing", companyId: "iren", sourceKind: "sec",
    sourceDocumentId: "sec:0001878848:0001878848-26-000026",
    origin: "curated-real-source", severity: "critical", active: true,
    expectations: {
      minimumSections: 3, minimumPassages: 8,
      expectedTopics: ["Operations", "Liquidity"],
      allowedMetricKeys: ["debt", "liquidity", "planned_power_capacity", "power_capacity", "revenue"],
      expectedMetrics: [
        { metricKey: "liquidity", value: 2_213.3, unit: "USD millions", tolerancePercent: 0 },
        { metricKey: "power_capacity", value: 4_510, unit: "MW", tolerancePercent: 0 },
      ],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: null, periodEnd: "2026-03-31" },
    },
  },
  {
    id: "real-source:iren:q2-fy2026-10q", suiteVersion: EXTRACTION_QUALITY_SUITE_VERSION, caseVersion: 1,
    title: "IREN Q2 FY2026 filing false-positive guard", companyId: "iren", sourceKind: "sec",
    sourceDocumentId: "sec:0001878848:0001878848-26-000015",
    origin: "production-failure", severity: "critical", active: true,
    expectations: {
      minimumSections: 3, minimumPassages: 8,
      expectedTopics: ["Liquidity"],
      allowedMetricKeys: ["debt", "liquidity", "planned_power_capacity", "power_capacity"],
      expectedMetrics: [{ metricKey: "liquidity", value: 3_260.6, unit: "USD millions", tolerancePercent: 0 }],
      forbiddenMetrics: [{ metricKey: "revenue", value: 23, tolerancePercent: 0 }],
      expectedPeriod: { periodKind: "quarter", fiscalYear: 2025, fiscalQuarter: null, periodEnd: "2025-12-31" },
    },
  },
];

const e2eCase: ExtractionBenchmarkCase = {
  id: "e2e-source:coreweave:capacity", suiteVersion: `${EXTRACTION_QUALITY_SUITE_VERSION}-fixture`, caseVersion: 1,
  title: "Archived CoreWeave capacity fixture", companyId: "coreweave", sourceKind: "ir",
  sourceDocumentId: "e2e-document:coreweave:capacity", origin: "ci-contract-fixture", severity: "critical", active: true,
  expectations: {
    minimumSections: 1, minimumPassages: 1, expectedTopics: ["Capacity"],
    allowedMetricKeys: ["planned_power_capacity"],
    expectedMetrics: [{ metricKey: "planned_power_capacity", value: 300, unit: "MW", tolerancePercent: 0 }],
  },
};

export function extractionBenchmarkCorpus() {
  return process.env.E2E_TEST === "1" ? [e2eCase] : realCases;
}
