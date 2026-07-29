"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, CircleAlert, ExternalLink, FileCheck2, LoaderCircle, RefreshCw, Scale, X } from "lucide-react";
import type { MetricObservation, MetricReviewStatus } from "@/lib/company-intelligence/metric-ledger";

type LedgerResponse = {
  companies: Array<{ id: string; name: string; ticker: string }>;
  definitions: Array<{ metricKey: string; label: string; category: string; unit: string }>;
  observations: MetricObservation[];
  latest: MetricObservation[];
  summary: { accepted: number; proposed: number; rejected: number; conflicts: number; coverage: number };
};

function statusLabel(status: MetricReviewStatus) {
  return status === "accepted" ? "Verified" : status === "rejected" ? "Excluded" : "Needs review";
}

export function MetricBenchmark() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [metricKey, setMetricKey] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading"); setError("");
    try {
      const response = await fetch("/api/company-metrics", { cache: "no-store" });
      const result = await response.json() as LedgerResponse | { error: string };
      if (!response.ok || !("observations" in result)) throw new Error("error" in result ? result.error : "Unable to load benchmark data.");
      setData(result);
      setMetricKey((current) => current || result.definitions[0]?.metricKey || "");
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load benchmark data."); setStatus("error");
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const latestByCell = useMemo(() => new Map((data?.latest ?? []).map((item) => [`${item.metricKey}:${item.companyId}`, item])), [data]);
  const timeline = useMemo(() => (data?.observations ?? []).filter((item) => item.metricKey === metricKey && item.reviewStatus !== "rejected")
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd)), [data, metricKey]);
  const selected = data?.observations.find((item) => item.id === selectedId) ?? null;
  const groupedTimeline = useMemo(() => (data?.companies ?? []).map((company) => ({
    company,
    observations: timeline.filter((item) => item.companyId === company.id),
  })), [data, timeline]);
  const maximum = Math.max(1, ...timeline.map((item) => Math.abs(item.normalizedValue)));

  const review = async (reviewStatus: MetricReviewStatus) => {
    if (!selected) return;
    setStatus("loading"); setError("");
    try {
      const response = await fetch("/api/company-metrics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, status: reviewStatus }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update the observation.");
      setSelectedId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the observation."); setStatus("error");
    }
  };

  if (!data && status === "loading") return <div className="workspace-state full metric-ledger-state"><LoaderCircle className="drawer-spinner" size={24} /><strong>Loading the metric ledger</strong></div>;
  if (!data) return <div className="workspace-state full metric-ledger-state"><CircleAlert size={24} /><strong>{error || "Metric ledger unavailable"}</strong><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div>;

  return <section className="metric-benchmark-workspace">
    {error && <div className="builder-error"><CircleAlert size={14} /> {error}</div>}
    <div className="metric-ledger-summary" aria-label="Metric ledger summary">
      <article><span>Verified observations</span><strong>{data.summary.accepted}</strong><small><FileCheck2 size={13} /> Analyst approved</small></article>
      <article><span>Review queue</span><strong>{data.summary.proposed}</strong><small>Structured and extracted</small></article>
      <article><span>Open conflicts</span><strong>{data.summary.conflicts}</strong><small><Scale size={13} /> Values disagree</small></article>
      <article><span>Peer coverage</span><strong>{data.summary.coverage}%</strong><small>{data.definitions.length} KPIs across {data.companies.length} companies</small></article>
    </div>

    <div className="metric-benchmark-grid">
      <div className="metric-benchmark-main">
        <section className="panel metric-matrix-panel">
          <header className="metric-panel-heading"><div><span className="section-kicker">Comparable fundamentals</span><h2>Neocloud peer matrix</h2><p>Latest reported observation, with review state and direct source provenance.</p></div><button className="icon-button" onClick={() => void load()} title="Refresh metrics" aria-label="Refresh metrics"><RefreshCw size={15} /></button></header>
          <div className="metric-matrix-scroll">
            <table className="metric-matrix"><thead><tr><th>Metric</th>{data.companies.map((company) => <th key={company.id}><strong>{company.ticker}</strong><span>{company.name}</span></th>)}</tr></thead><tbody>{data.definitions.map((definition) => <tr key={definition.metricKey}><th><strong>{definition.label}</strong><span>{definition.category} · {definition.unit}</span></th>{data.companies.map((company) => { const item = latestByCell.get(`${definition.metricKey}:${company.id}`); return <td key={company.id}>{item ? <button className={`metric-matrix-value ${item.reviewStatus}${item.conflictStatus === "open" ? " conflict" : ""}`} onClick={() => { setMetricKey(definition.metricKey); setSelectedId(item.id); }}><strong>{item.displayValue}</strong><span>{item.periodLabel}</span><small>{item.conflictStatus === "open" ? "Conflict" : statusLabel(item.reviewStatus)}</small></button> : <span className="metric-matrix-empty">No observation</span>}</td>; })}</tr>)}</tbody></table>
          </div>
        </section>

        <section className="panel metric-history-panel">
          <header className="metric-panel-heading"><div><span className="section-kicker">Source-linked history</span><h2>{data.definitions.find((item) => item.metricKey === metricKey)?.label ?? "Metric history"}</h2></div><label><span>Metric</span><select value={metricKey} onChange={(event) => { setMetricKey(event.target.value); setSelectedId(""); }}>{data.definitions.map((definition) => <option value={definition.metricKey} key={definition.metricKey}>{definition.label}</option>)}</select></label></header>
          <div className="metric-history-list">{groupedTimeline.map(({ company, observations }) => <article key={company.id}><div className="metric-history-company"><strong>{company.ticker}</strong><span>{company.name}</span></div><div className="metric-history-track">{observations.map((item) => <button key={item.id} className={item.reviewStatus} style={{ "--metric-width": `${Math.max(4, Math.abs(item.normalizedValue) / maximum * 100)}%` } as CSSProperties} onClick={() => setSelectedId(item.id)}><i /><span><strong>{item.displayValue}</strong><small>{item.periodLabel}</small></span></button>)}{!observations.length && <span className="metric-history-empty">No comparable history</span>}</div></article>)}</div>
        </section>
      </div>

      <aside className="panel metric-review-panel">
        <header><span className="section-kicker">Analyst control</span><h2>Observation review</h2></header>
        {selected ? <div className="metric-review-body">
          <div className="metric-review-value"><span>{selected.ticker} · {selected.periodLabel}</span><strong>{selected.displayValue}</strong><small className={selected.reviewStatus}>{statusLabel(selected.reviewStatus)}</small></div>
          {selected.conflictStatus === "open" && <div className="metric-conflict-notice"><CircleAlert size={15} /><span><strong>Conflicting values</strong>Other sources report a materially different value for this KPI and period.</span></div>}
          <dl><div><dt>Metric</dt><dd>{selected.label}</dd></div><div><dt>Value type</dt><dd>{selected.valueType}</dd></div><div><dt>Confidence</dt><dd>{selected.confidence}%</dd></div><div><dt>Source</dt><dd>{selected.sourceLabel}</dd></div>{selected.concept && <div><dt>Taxonomy</dt><dd>{selected.taxonomy}:{selected.concept}</dd></div>}</dl>
          <blockquote>{selected.context}</blockquote>
          {selected.sourceUrl && <a className="metric-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open source filing</a>}
          <div className="metric-review-actions"><button className="review-accept" disabled={status === "loading"} onClick={() => void review("accepted")}><Check size={15} /> Accept</button><button className="review-reject" disabled={status === "loading"} onClick={() => void review("rejected")}><X size={15} /> Reject</button></div>
          <p className="metric-review-help">Accepted observations become available to research outputs. Resolving a conflict excludes competing values from downstream analysis.</p>
        </div> : <div className="workspace-state"><Scale size={24} /><strong>Select a value to inspect</strong><span>Every cell keeps its source, period, extraction method, and review state.</span></div>}
      </aside>
    </div>
  </section>;
}
