"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarRange,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileDiff,
  FileText,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { CompanyIntelligenceResponse, IntelligenceComparison } from "@/lib/company-intelligence/types";

function DirectionIcon({ direction }: { direction: IntelligenceComparison["direction"] }) {
  if (direction === "increased") return <ArrowUpRight size={14} />;
  if (direction === "decreased" || direction === "removed") return <ArrowDownRight size={14} />;
  if (direction === "new") return <CircleDot size={13} />;
  return <ArrowRight size={14} />;
}

export function CompanyIntelligenceWorkspace() {
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

  useEffect(() => { queueMicrotask(() => void load()); }, []);

  const metrics = useMemo(() => data?.comparisons.filter((item) => item.comparisonKind === "metric") ?? [], [data]);
  const disclosures = useMemo(() => data?.comparisons.filter((item) => item.comparisonKind === "disclosure") ?? [], [data]);
  const activeComparison = data?.comparisons.find((item) => item.id === selectedComparisonId) ?? data?.comparisons[0];
  const activeEvidence = activeComparison ? data?.evidence.filter((item) => activeComparison.evidenceIds.includes(item.id)) ?? [] : [];
  const currentIndex = data?.periods.findIndex((period) => period.id === data.currentPeriod.id) ?? -1;
  const previousOptions = currentIndex >= 0 ? data?.periods.slice(currentIndex + 1) ?? [] : [];

  if (!data && status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Building company intelligence</strong></div></div>;

  return <div className="research-workspace company-intelligence-workspace">
    <header className="workspace-title-row"><div><p className="breadcrumb">Research workspace / Temporal analysis</p><h1>Company Intelligence</h1><p className="workspace-subtitle">Reporting-period changes across capacity, demand, capital, funding, and management disclosures.</p></div><button className="command-button" disabled={status === "loading"} onClick={() => void load({ company: data?.company.id, sync: true })}>{status === "loading" ? <LoaderCircle className="drawer-spinner" size={15} /> : <RefreshCw size={15} />} Refresh analysis</button></header>
    {error && <div className="builder-error"><ShieldAlert size={14} /> {error}</div>}
    {data && <section className="company-intelligence-layout">
      <aside className="panel company-coverage-panel"><div className="catalog-heading"><div><h2>Neocloud coverage</h2><span>{data.companies.length} companies</span></div><Building2 size={17} /></div>{data.companies.map((company) => <button key={company.id} className={company.id === data.company.id ? "active" : ""} onClick={() => void load({ company: company.id })}><span>{company.ticker}</span><div><strong>{company.name}</strong><small>{company.periodCount} periods · {company.latestPeriod}</small></div><ChevronRight size={14} /></button>)}</aside>

      <div className="company-intelligence-main">
        <section className="panel company-period-header"><div className="company-identity"><span>{data.company.ticker}</span><div><p className="section-kicker">Neocloud intelligence</p><h2>{data.company.name}</h2></div></div><div className="period-comparison-controls"><label><span>Current period</span><select value={data.currentPeriod.id} onChange={(event) => { const index = data.periods.findIndex((period) => period.id === event.target.value); void load({ company: data.company.id, current: event.target.value, previous: data.periods[index + 1]?.id }); }}>{data.periods.map((period) => <option value={period.id} key={period.id}>{period.label}</option>)}</select></label><ArrowRight size={16} /><label><span>Compare with</span><select value={data.previousPeriod?.id ?? ""} onChange={(event) => void load({ company: data.company.id, current: data.currentPeriod.id, previous: event.target.value })}><option value="">No prior period</option>{previousOptions.map((period) => <option value={period.id} key={period.id}>{period.label}</option>)}</select></label></div></section>

        <section className="intelligence-metrics-strip"><article><Gauge size={17} /><span>Tracked metrics</span><strong>{data.summary.metrics}</strong></article><article><FileDiff size={17} /><span>Disclosure changes</span><strong>{data.summary.disclosures}</strong></article><article><ShieldAlert size={17} /><span>High significance</span><strong>{data.summary.highSignificance}</strong></article><article><FileText size={17} /><span>Source documents</span><strong>{data.summary.evidenceSources}</strong></article></section>

        <section className="intelligence-content-grid">
          <div className="intelligence-change-column">
            <section className="panel metric-comparison-panel"><div className="catalog-heading"><div><h2>Reported metrics</h2><span>{data.currentPeriod.label} versus {data.previousPeriod?.label ?? "no prior period"}</span></div><CalendarRange size={17} /></div><div className="metric-comparison-grid">{metrics.map((item) => <button key={item.id} className={`metric-change-card ${selectedComparisonId === item.id ? "active" : ""}`} onClick={() => setSelectedComparisonId(item.id)}><div><span>{item.category}</span><strong>{item.label}</strong></div><div className={`metric-direction ${item.direction}`}><DirectionIcon direction={item.direction} /><b>{item.deltaPercent === null ? item.direction : `${item.deltaPercent > 0 ? "+" : ""}${item.deltaPercent}%`}</b></div><div className="metric-values"><span>{item.previousValue ?? "Not identified"}</span><ArrowRight size={12} /><strong>{item.currentValue}</strong></div></button>)}{!metrics.length && <p className="missing-evidence">No comparable structured metrics were explicitly stated in this period.</p>}</div></section>

            <section className="panel disclosure-comparison-panel"><div className="catalog-heading"><div><h2>Disclosure changes</h2><span>Form-aware filing comparisons</span></div><FileDiff size={17} /></div><div className="disclosure-change-list">{disclosures.map((item) => <button key={item.id} className={selectedComparisonId === item.id ? "active" : ""} onClick={() => setSelectedComparisonId(item.id)}><i className={item.significance} /><span className={`change-direction ${item.direction}`}><DirectionIcon direction={item.direction} />{item.direction}</span><div><strong>{item.label}</strong><p>{item.summary}</p><small>{item.category} · {item.significance} significance · tone {item.tone}</small></div><ChevronRight size={14} /></button>)}{!disclosures.length && <p className="missing-evidence">No material form-aware disclosure changes were identified for this period.</p>}</div></section>
          </div>

          <aside className="intelligence-context-column">
            <section className="panel comparison-context-panel"><div className="catalog-heading"><div><h2>Change evidence</h2><span>{activeComparison?.label ?? "Select a change"}</span></div><FileText size={17} /></div>{activeComparison ? <div className="comparison-context-body"><div className="comparison-badges"><span className={`impact-pill ${activeComparison.direction}`}>{activeComparison.significance} · {activeComparison.direction}</span>{activeComparison.comparisonKind === "disclosure" && <span className={`tone-badge ${activeComparison.tone.replace(" ", "-")}`}>Tone {activeComparison.tone}</span>}</div><h3>{activeComparison.summary}</h3>{activeComparison.currentText && <div className="period-text current"><span>{data.currentPeriod.label}</span><p>{activeComparison.currentText}</p></div>}{activeComparison.previousText && <div className="period-text previous"><span>{data.previousPeriod?.label ?? "Prior disclosure"}</span><p>{activeComparison.previousText}</p></div>}<div className="comparison-source-list">{activeEvidence.map((evidence) => <a href={evidence.pageNumber ? `${evidence.sourceUrl}#page=${evidence.pageNumber}` : evidence.sourceUrl} target="_blank" rel="noreferrer" key={evidence.id}><FileText size={14} /><span><strong>{evidence.sourceType}</strong><small>{evidence.documentTitle} · {evidence.documentDate}</small></span><ExternalLink size={13} /></a>)}</div></div> : <div className="workspace-state"><FileDiff size={24} /><strong>No change selected</strong></div>}</section>
            <section className="panel company-thesis-panel"><div className="catalog-heading"><div><h2>Thesis state</h2><span>{data.claims.length} tracked claims</span></div><Gauge size={17} /></div>{data.claims.map((claim) => <article key={claim.id}><div><strong>{claim.title}</strong><p>{claim.statement}</p></div><span className={claim.supportScore >= 55 ? "positive" : claim.supportScore < 45 ? "negative" : "neutral"}>{claim.supportScore}</span></article>)}</section>
          </aside>
        </section>
      </div>
    </section>}
  </div>;
}
