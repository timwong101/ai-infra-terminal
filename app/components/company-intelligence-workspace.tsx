"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Building2,
  CalendarRange,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileDiff,
  FileText,
  Gauge,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { CompanyIntelligenceResponse, IntelligenceComparison } from "@/lib/company-intelligence/types";

type Props = {
  initialCompanyId?: string;
  onCompanyChange?: (companyId: string) => void;
};

function DirectionIcon({ direction }: { direction: IntelligenceComparison["direction"] }) {
  if (direction === "increased") return <ArrowUpRight size={14} />;
  if (direction === "decreased" || direction === "removed") return <ArrowDownRight size={14} />;
  if (direction === "new") return <CircleDot size={13} />;
  return <ArrowRight size={14} />;
}

export function CompanyIntelligenceWorkspace({ initialCompanyId = "", onCompanyChange }: Props) {
  const [data, setData] = useState<CompanyIntelligenceResponse | null>(null);
  const [selectedComparisonId, setSelectedComparisonId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = async (params: { company?: string; current?: string; previous?: string; sync?: boolean } = {}) => {
    setStatus("loading"); setError("");
    const query = new URLSearchParams();
    if (params.company) query.set("company", params.company);
    if (params.current) query.set("current", params.current);
    if (params.previous) query.set("previous", params.previous);
    if (params.sync) query.set("sync", "1");
    try {
      const response = await fetch(`/api/company-intelligence?${query}`, { cache: "no-store" });
      const result = await response.json() as CompanyIntelligenceResponse | { error: string };
      if (!response.ok || !("company" in result)) throw new Error("error" in result ? result.error : "Unable to load company intelligence.");
      setData(result); setSelectedComparisonId(result.comparisons[0]?.id ?? ""); setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load company intelligence."); setStatus("error");
    }
  };

  useEffect(() => { queueMicrotask(() => void load({ company: initialCompanyId || undefined })); }, [initialCompanyId]);

  const selectCompany = (companyId: string) => {
    onCompanyChange?.(companyId);
    if (!onCompanyChange) void load({ company: companyId });
  };

  const metrics = useMemo(() => data?.comparisons.filter((item) => item.comparisonKind === "metric") ?? [], [data]);
  const disclosures = useMemo(() => data?.comparisons.filter((item) => item.comparisonKind === "disclosure") ?? [], [data]);
  const evidenceById = useMemo(() => new Map((data?.evidence ?? []).map((item) => [item.id, item])), [data]);
  const activeComparison = data?.comparisons.find((item) => item.id === selectedComparisonId) ?? data?.comparisons[0];
  const activeEvidence = activeComparison ? data?.evidence.filter((item) => activeComparison.evidenceIds.includes(item.id)) ?? [] : [];
  const currentIndex = data?.periods.findIndex((period) => period.id === data.currentPeriod.id) ?? -1;
  const previousOptions = currentIndex >= 0
    ? data?.periods.slice(currentIndex + 1).filter((period) => period.periodKind === data.currentPeriod.periodKind) ?? []
    : [];

  if (!data && status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Building company intelligence</strong></div></div>;

  return <div className="research-workspace company-intelligence-workspace">
    <header className="workspace-title-row"><div><p className="breadcrumb">Research workspace / Temporal analysis</p><h1>Company Intelligence</h1><p className="workspace-subtitle">Reporting-period changes across capacity, demand, capital, funding, and management disclosures.</p></div><button className="command-button" disabled={status === "loading"} onClick={() => void load({ company: data?.company.id, sync: true })}>{status === "loading" ? <LoaderCircle className="drawer-spinner" size={15} /> : <RefreshCw size={15} />} Refresh analysis</button></header>
    {error && <div className="builder-error"><ShieldAlert size={14} /> {error}</div>}
    {data && <section className="company-intelligence-layout">
      <aside className="panel company-coverage-panel"><div className="catalog-heading"><div><h2>Neocloud coverage</h2><span>{data.companies.length} companies</span></div><Building2 size={17} /></div>{data.companies.map((company) => <button key={company.id} className={company.id === data.company.id ? "active" : ""} onClick={() => selectCompany(company.id)}><span>{company.ticker}</span><div><strong>{company.name}</strong><small>{company.periodCount} periods · {company.latestPeriod}</small></div><ChevronRight size={14} /></button>)}</aside>

      <div className="company-intelligence-main">
        <section className="panel company-period-header"><div className="company-identity"><span>{data.company.ticker}</span><div><p className="section-kicker">Neocloud intelligence</p><h2>{data.company.name}</h2><div className="period-resolution"><b>{data.currentPeriod.periodBasis === "calendar-fallback" ? "Calendar fallback" : data.currentPeriod.periodBasis}</b><small>{data.currentPeriod.resolutionMethod.replaceAll("-", " ")} · {data.currentPeriod.resolutionConfidence}% confidence</small></div></div></div><div className="period-comparison-controls"><label><span>Current period</span><select value={data.currentPeriod.id} onChange={(event) => { const index = data.periods.findIndex((period) => period.id === event.target.value); const selected = data.periods[index]; const prior = data.periods.slice(index + 1).find((period) => period.periodKind === selected.periodKind); void load({ company: data.company.id, current: event.target.value, previous: prior?.id }); }}>{data.periods.map((period) => <option value={period.id} key={period.id}>{period.label}{period.periodBasis === "calendar-fallback" ? " · fallback" : ""}</option>)}</select></label><ArrowRight size={16} /><label><span>Compare with</span><select value={data.previousPeriod?.id ?? ""} onChange={(event) => void load({ company: data.company.id, current: data.currentPeriod.id, previous: event.target.value })}><option value="">No prior period</option>{previousOptions.map((period) => <option value={period.id} key={period.id}>{period.label}</option>)}</select></label></div></section>

        <section className="intelligence-metrics-strip"><article><Gauge size={17} /><span>Tracked metrics</span><strong>{data.summary.metrics}</strong></article><article><FileDiff size={17} /><span>Disclosure changes</span><strong>{data.summary.disclosures}</strong></article><article><ShieldAlert size={17} /><span>High significance</span><strong>{data.summary.highSignificance}</strong></article><article><FileText size={17} /><span>Source documents</span><strong>{data.summary.evidenceSources}</strong></article></section>

        <section className="intelligence-content-grid">
          <div className="intelligence-change-column">
            <section className="panel earnings-change-brief-panel"><div className="catalog-heading"><div><h2>Earnings change brief</h2><span>{data.changeBrief ? `${data.currentPeriod.label} versus ${data.previousPeriod?.label ?? "prior period"}` : "No comparable brief available"}</span></div><BookOpenCheck size={17} /></div>{data.changeBrief ? <div className="change-brief-body"><div className="change-brief-summary"><div><span className={`thesis-impact ${data.changeBrief.thesisImpact}`}>{data.changeBrief.thesisImpact}</span><span className="brief-confidence">{data.changeBrief.confidenceScore}% confidence</span></div><h3>{data.changeBrief.headline}</h3><p>{data.changeBrief.summary}</p><small>Evidence quality {data.changeBrief.evidenceQualityScore} · source diversity {data.changeBrief.sourceDiversityScore} · {data.changeBrief.versionHistory?.length ?? 0} saved {(data.changeBrief.versionHistory?.length ?? 0) === 1 ? "version" : "versions"} · {data.changeBrief.engine.replaceAll("-", " ")}</small></div><div className="change-brief-sections">{data.changeBrief.sections.map((section) => <article className={`change-brief-section ${section.key}`} key={section.key}><header><strong>{section.title}</strong><span>{section.claims.length}</span></header>{section.claims.length ? <div>{section.claims.map((claim) => <div className="brief-claim" key={claim.id}><i className={claim.sentiment} /><span><strong>{claim.title}</strong><p>{claim.text}</p>{claim.evidenceIds.length > 0 && <small>{claim.evidenceIds.map((evidenceId, index) => { const evidence = evidenceById.get(evidenceId); return evidence ? <a href={evidence.pageNumber ? `${evidence.sourceUrl}#page=${evidence.pageNumber}` : evidence.sourceUrl} target="_blank" rel="noreferrer" title={`${evidence.sourceType}: ${evidence.documentTitle}`} key={evidenceId}><FileText size={10} />{index + 1}</a> : null; })}</small>}</span></div>)}</div> : <p className="brief-empty">No grounded claims in this section.</p>}</article>)}</div></div> : <p className="missing-evidence">A persisted brief is created when this period has a comparable prior reporting period and cited change evidence.</p>}</section>
            <section className="panel metric-comparison-panel"><div className="catalog-heading"><div><h2>Reported metrics</h2><span>{data.currentPeriod.label} versus {data.previousPeriod?.label ?? "no prior period"}</span></div><CalendarRange size={17} /></div><div className="metric-comparison-grid">{metrics.map((item) => <button key={item.id} className={`metric-change-card ${selectedComparisonId === item.id ? "active" : ""}`} onClick={() => setSelectedComparisonId(item.id)}><div><span>{item.category}</span><strong>{item.label}</strong></div><div className={`metric-direction ${item.direction}`}><DirectionIcon direction={item.direction} /><b>{item.deltaPercent === null ? item.direction : `${item.deltaPercent > 0 ? "+" : ""}${item.deltaPercent}%`}</b></div><div className="metric-values"><span>{item.previousValue ?? "Not identified"}</span><ArrowRight size={12} /><strong>{item.currentValue}</strong></div></button>)}{!metrics.length && <p className="missing-evidence">No comparable structured metrics were explicitly stated in this period.</p>}</div></section>

            <section className="panel disclosure-comparison-panel"><div className="catalog-heading"><div><h2>Disclosure changes</h2><span>Form-aware filing comparisons</span></div><FileDiff size={17} /></div><div className="disclosure-change-list">{disclosures.map((item) => <button key={item.id} className={selectedComparisonId === item.id ? "active" : ""} onClick={() => setSelectedComparisonId(item.id)}><i className={item.significance} /><span className={`change-direction ${item.direction}`}><DirectionIcon direction={item.direction} />{item.direction}</span><div><strong>{item.label}</strong><p>{item.summary}</p><small>{item.category} · {item.significance} significance · tone {item.tone}</small></div><ChevronRight size={14} /></button>)}{!disclosures.length && <p className="missing-evidence">No material form-aware disclosure changes were identified for this period.</p>}</div></section>
          </div>

          <aside className="intelligence-context-column">
            <section className="panel earnings-package-panel"><div className="catalog-heading"><div><h2>Earnings package</h2><span>{data.earningsPackage ? `${data.earningsPackage.documentCount} documents · ${data.earningsPackage.evidenceCount} passages` : "No package available"}</span></div><PackageOpen size={17} /></div>{data.earningsPackage ? <div className="earnings-package-list">{data.earningsPackage.documents.map((document) => <a href={document.sourceUrl} target="_blank" rel="noreferrer" key={document.id}><span className={document.resolutionConfidence >= 90 ? "resolved" : document.resolutionConfidence >= 70 ? "inferred" : "fallback"}>{document.resolutionConfidence}</span><div><strong>{document.sourceType}</strong><p>{document.documentTitle}</p><small>Published {document.publicationDate}{document.periodOfReport ? ` · reports ${document.periodOfReport}` : ""}</small><em>{document.resolutionMethod.replaceAll("-", " ")}</em></div><ExternalLink size={13} /></a>)}</div> : <p className="missing-evidence">No source documents were assigned to this period.</p>}</section>
            <section className="panel comparison-context-panel"><div className="catalog-heading"><div><h2>Change evidence</h2><span>{activeComparison?.label ?? "Select a change"}</span></div><FileText size={17} /></div>{activeComparison ? <div className="comparison-context-body"><div className="comparison-badges"><span className={`impact-pill ${activeComparison.direction}`}>{activeComparison.significance} · {activeComparison.direction}</span>{activeComparison.comparisonKind === "disclosure" && <span className={`tone-badge ${activeComparison.tone.replace(" ", "-")}`}>Tone {activeComparison.tone}</span>}</div><h3>{activeComparison.summary}</h3>{activeComparison.currentText && <div className="period-text current"><span>{data.currentPeriod.label}</span><p>{activeComparison.currentText}</p></div>}{activeComparison.previousText && <div className="period-text previous"><span>{data.previousPeriod?.label ?? "Prior disclosure"}</span><p>{activeComparison.previousText}</p></div>}<div className="comparison-source-list">{activeEvidence.map((evidence) => <a href={evidence.pageNumber ? `${evidence.sourceUrl}#page=${evidence.pageNumber}` : evidence.sourceUrl} target="_blank" rel="noreferrer" key={evidence.id}><FileText size={14} /><span><strong>{evidence.sourceType}</strong><small>{evidence.documentTitle} · {evidence.documentDate}</small></span><ExternalLink size={13} /></a>)}</div></div> : <div className="workspace-state"><FileDiff size={24} /><strong>No change selected</strong></div>}</section>
            <section className="panel company-thesis-panel"><div className="catalog-heading"><div><h2>Thesis state</h2><span>{data.claims.length} tracked claims</span></div><Gauge size={17} /></div>{data.claims.map((claim) => <article key={claim.id}><div><strong>{claim.title}</strong><p>{claim.statement}</p></div><span className={claim.supportScore >= 55 ? "positive" : claim.supportScore < 45 ? "negative" : "neutral"}>{claim.supportScore}</span></article>)}</section>
          </aside>
        </section>
      </div>
    </section>}
  </div>;
}
