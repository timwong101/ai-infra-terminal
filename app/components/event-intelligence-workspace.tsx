"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Filter,
  LoaderCircle,
  Newspaper,
  Radar,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import type { LiveEventCatalog } from "@/lib/events/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function EventIntelligenceWorkspace() {
  const [catalog, setCatalog] = useState<LiveEventCatalog | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "refreshing" | "error">("loading");
  const [error, setError] = useState("");
  const [company, setCompany] = useState("all");
  const [source, setSource] = useState("all");
  const [minimumMateriality, setMinimumMateriality] = useState("0");
  const [selectedId, setSelectedId] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/events", { cache: "no-store", signal });
    const result = await response.json() as LiveEventCatalog | { error: string };
    if (!response.ok || !("events" in result)) throw new Error("error" in result ? result.error : "Unable to load event intelligence.");
    setCatalog(result);
    setSelectedId((current) => current || result.events[0]?.id || "");
    setStatus("ready");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Unable to load event intelligence.");
      }
    }));
    return () => controller.abort();
  }, [load]);

  const refresh = async () => {
    setStatus("refreshing");
    setError("");
    try {
      const response = await fetch("/api/events", { method: "POST" });
      const result = await response.json() as { catalog?: LiveEventCatalog; error?: string };
      if (!response.ok || !result.catalog) throw new Error(result.error || "Event refresh failed.");
      setCatalog(result.catalog);
      setSelectedId(result.catalog.events[0]?.id || "");
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Event refresh failed.");
    }
  };

  const visible = useMemo(() => (catalog?.events ?? []).filter((item) =>
    (company === "all" || item.companyId === company)
    && (source === "all" || item.sourceKind === source)
    && item.materialityScore >= Number(minimumMateriality)
  ), [catalog?.events, company, minimumMateriality, source]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  if (!catalog && status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading event intelligence</strong></div></div>;

  return <div className="research-workspace events-workspace">
    <header className="workspace-title-row">
      <div><p className="breadcrumb">Research workspace / Continuous monitoring</p><h1>Live Event Intelligence</h1><p className="workspace-subtitle">Official issuer updates and GDELT discovery signals, normalized into one auditable Neocloud timeline.</p></div>
      <button className="primary-button" disabled={status === "refreshing"} onClick={() => void refresh()}>{status === "refreshing" ? <LoaderCircle className="drawer-spinner" size={15} /> : <RefreshCw size={15} />} Refresh sources</button>
    </header>
    {error && <div className="builder-error"><AlertTriangle size={15} />{error}</div>}

    <section className="event-metrics">
      <article><Newspaper size={17} /><span>Tracked events</span><strong>{catalog?.summary.total ?? 0}</strong><small>Last 120 days</small></article>
      <article><FileCheck2 size={17} /><span>Official updates</span><strong>{catalog?.summary.official ?? 0}</strong><small>Issuer-originated</small></article>
      <article><Radar size={17} /><span>Discovery signals</span><strong>{catalog?.summary.discovery ?? 0}</strong><small>Verification required</small></article>
      <article><Sparkles size={17} /><span>High materiality</span><strong>{catalog?.summary.highMateriality ?? 0}</strong><small>Score 82+</small></article>
    </section>

    <div className="event-policy">
      <ShieldQuestion size={17} />
      <div><strong>Discovery is not evidence</strong><span>GDELT identifies potentially material coverage. Only official, extracted, analyst-approved passages can support a memo or change a thesis score.</span></div>
    </div>

    <div className="events-toolbar">
      <Filter size={14} />
      <select aria-label="Filter event company" value={company} onChange={(event) => { setCompany(event.target.value); setSelectedId(""); }}>
        <option value="all">All companies</option>{catalog?.companies.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.ticker})</option>)}
      </select>
      <select aria-label="Filter event source" value={source} onChange={(event) => { setSource(event.target.value); setSelectedId(""); }}>
        <option value="all">All sources</option><option value="official-ir">Official IR</option><option value="gdelt">GDELT discovery</option>
      </select>
      <select aria-label="Filter minimum materiality" value={minimumMateriality} onChange={(event) => setMinimumMateriality(event.target.value)}>
        <option value="0">All materiality</option><option value="68">Material 68+</option><option value="82">High 82+</option>
      </select>
      <span>{visible.length} events</span>
    </div>

    <section className="events-layout">
      <div className="panel event-stream">
        <div className="catalog-heading"><div><h2>Event timeline</h2><span>Newest signals first</span></div><Radar size={16} /></div>
        <div className="event-list">{visible.map((item) => <button className={selected?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
          <span className={`event-source-mark ${item.evidenceStatus}`} />
          <div>
            <p><b>{item.ticker}</b><span>{item.eventType}</span><span className={item.evidenceStatus}>{item.evidenceStatus === "official" ? "Official" : "Discovery"}</span></p>
            <strong>{item.title}</strong>
            <small>{item.sourceDomain} · {formatDate(item.publishedAt)}</small>
          </div>
          <em>{item.materialityScore}</em>
        </button>)}</div>
        {!visible.length && <div className="workspace-state"><Radar size={23} /><strong>No events match these filters</strong><span>Refresh sources or broaden the materiality policy.</span></div>}
      </div>

      <aside className="panel event-detail">
        {selected ? <>
          <div className="event-detail-heading">
            <span className={`evidence-policy-badge ${selected.evidenceStatus}`}>{selected.evidenceStatus === "official" ? <CheckCircle2 size={13} /> : <ShieldQuestion size={13} />}{selected.evidenceStatus}</span>
            <span>{selected.eventType}</span>
          </div>
          <h2>{selected.title}</h2>
          <p>{selected.summary}</p>
          <div className="event-score-grid">
            <div><span>Materiality</span><strong>{selected.materialityScore}</strong><i><b style={{ width: `${selected.materialityScore}%` }} /></i></div>
            <div><span>Credibility</span><strong>{selected.credibilityScore}</strong><i><b style={{ width: `${selected.credibilityScore}%` }} /></i></div>
          </div>
          <dl>
            <div><dt>Company</dt><dd><Building2 size={12} />{selected.companyName} ({selected.ticker})</dd></div>
            <div><dt>Source</dt><dd>{selected.sourceName} · {selected.sourceDomain}</dd></div>
            <div><dt>Published</dt><dd>{formatDate(selected.publishedAt)}</dd></div>
          </dl>
          {selected.claimImpact && <div className="event-claim-impact"><span>Proposed thesis impact</span><strong>{selected.claimImpact.claimTitle}</strong><p><b className={selected.claimImpact.impact}>{selected.claimImpact.impact}</b>{selected.claimImpact.rationale}</p></div>}
          <a className="command-button event-source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open source <ExternalLink size={14} /></a>
        </> : <div className="workspace-state full"><Radar size={24} /><strong>Select an event</strong></div>}
      </aside>
    </section>
  </div>;
}
