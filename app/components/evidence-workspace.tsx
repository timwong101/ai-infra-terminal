"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Check, ExternalLink, FileCheck2, Filter, LoaderCircle, Search, ShieldCheck, X } from "lucide-react";
import type { EvidenceReviewStatus, EvidenceWorkspaceResponse, ResearchEvidenceItem } from "@/lib/research/types";

type Props = { onBuildComparison: () => void };

const EMPTY_RESPONSE: EvidenceWorkspaceResponse = {
  items: [], total: 0, summary: { unreviewed: 0, accepted: 0, rejected: 0 }, companies: [], topics: [], synced: { sec: 0, ir: 0 },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function EvidenceWorkspace({ onBuildComparison }: Props) {
  const [data, setData] = useState(EMPTY_RESPONSE);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState("");
  const [review, setReview] = useState("");
  const [selected, setSelected] = useState<ResearchEvidenceItem | null>(null);
  const [updating, setUpdating] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(100);

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading");
    try {
      const response = await fetch("/api/research-evidence", { cache: "no-store", signal });
      const result = await response.json() as EvidenceWorkspaceResponse | { error: string };
      if (!response.ok || !("items" in result)) throw new Error("error" in result ? result.error : "Unable to load evidence.");
      setData(result);
      setStatus("ready");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Unable to load evidence.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.items.filter((item) =>
      (!normalized || [item.companyName, item.ticker, item.documentTitle, item.sectionTitle, item.topic, item.excerpt].join(" ").toLowerCase().includes(normalized)) &&
      (!company || item.companyId === company) &&
      (!topic || item.topic === topic) &&
      (!source || item.sourceKind === source) &&
      (!review || item.reviewStatus === review)
    );
  }, [company, data.items, query, review, source, topic]);
  const visibleItems = filtered.slice(0, visibleLimit);

  const updateReview = async (ids: string[], nextStatus: EvidenceReviewStatus) => {
    if (!ids.length) return;
    setUpdating(true);
    try {
      const response = await fetch("/api/research-evidence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: nextStatus }),
      });
      const result = await response.json() as { updated?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to update evidence.");
      setData((current) => {
        const idSet = new Set(ids);
        const items = current.items.map((item) => idSet.has(item.id) ? { ...item, reviewStatus: nextStatus, reviewedAt: new Date().toISOString() } : item);
        const summary = { unreviewed: 0, accepted: 0, rejected: 0 };
        for (const item of items) summary[item.reviewStatus] += 1;
        return { ...current, items, summary };
      });
      setSelected((current) => current && ids.includes(current.id) ? { ...current, reviewStatus: nextStatus, reviewedAt: new Date().toISOString() } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update evidence.");
    } finally {
      setUpdating(false);
    }
  };

  const resetFilters = () => { setQuery(""); setCompany(""); setTopic(""); setSource(""); setReview(""); setVisibleLimit(100); };

  return (
    <div className="research-workspace evidence-workspace-page">
      <header className="workspace-title-row">
        <div><p className="breadcrumb">Research workspace / Provenance</p><h1>Evidence Workspace</h1><p className="workspace-subtitle">Review citation-ready passages before they can support a research memo.</p></div>
        <button className="primary-button" onClick={onBuildComparison}><FileCheck2 size={16} /> Build comparison</button>
      </header>

      <section className="evidence-metrics" aria-label="Evidence review summary">
        <article><span>Cataloged passages</span><strong>{data.total}</strong><small>{data.synced.sec} SEC · {data.synced.ir} IR</small></article>
        <article><span>Needs review</span><strong>{data.summary.unreviewed}</strong><small>Not eligible for memos</small></article>
        <article><span>Accepted</span><strong>{data.summary.accepted}</strong><small>Eligible for grounded claims</small></article>
        <article><span>Rejected</span><strong>{data.summary.rejected}</strong><small>Excluded from generation</small></article>
      </section>

      <section className="evidence-toolbar" aria-label="Evidence filters">
        <label className="workspace-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(100); }} placeholder="Search passages, topics, companies..." />{query && <button onClick={() => { setQuery(""); setVisibleLimit(100); }} aria-label="Clear search"><X size={14} /></button>}</label>
        <select aria-label="Filter by company" value={company} onChange={(event) => { setCompany(event.target.value); setVisibleLimit(100); }}><option value="">All companies</option>{data.companies.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.ticker}) · {item.evidenceCount}</option>)}</select>
        <select aria-label="Filter by topic" value={topic} onChange={(event) => { setTopic(event.target.value); setVisibleLimit(100); }}><option value="">All topics</option>{data.topics.map((item) => <option value={item.name} key={item.name}>{item.name} · {item.evidenceCount}</option>)}</select>
        <select aria-label="Filter by source" value={source} onChange={(event) => { setSource(event.target.value); setVisibleLimit(100); }}><option value="">SEC + IR</option><option value="sec">SEC filings</option><option value="ir">Investor relations</option></select>
        <select aria-label="Filter by review status" value={review} onChange={(event) => { setReview(event.target.value); setVisibleLimit(100); }}><option value="">All review states</option><option value="unreviewed">Unreviewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select>
        <button className="icon-button" onClick={resetFilters} aria-label="Reset evidence filters" title="Reset filters"><Filter size={15} /></button>
      </section>

      <div className="evidence-review-layout">
        <section className="evidence-catalog panel">
          <div className="catalog-heading"><div><h2>Source passages</h2><span>{visibleItems.length} of {filtered.length} shown</span></div><button className="command-button small" disabled={updating || !visibleItems.some((item) => item.reviewStatus === "unreviewed")} onClick={() => void updateReview(visibleItems.filter((item) => item.reviewStatus === "unreviewed").map((item) => item.id), "accepted")}><Check size={14} /> Accept visible</button></div>
          {status === "loading" && <div className="workspace-state"><LoaderCircle className="drawer-spinner" size={24} /><strong>Building unified evidence catalog</strong><span>Normalizing SEC and IR passages with source provenance.</span></div>}
          {status === "error" && <div className="workspace-state error"><strong>Evidence workspace unavailable</strong><span>{error}</span><button className="command-button" onClick={() => void load()}>Try again</button></div>}
          {status === "ready" && <div className="evidence-catalog-list">
            {visibleItems.map((item) => <article className={`catalog-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} tabIndex={0} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(item); }}>
              <div className="catalog-row-main"><div className="catalog-badges"><span className={`review-badge ${item.reviewStatus}`}>{item.reviewStatus}</span><span>{item.sourceType}</span><span>{item.topic}</span></div><h3>{item.companyName} <em>{item.ticker}</em></h3><p>{item.excerpt}</p><div className="catalog-meta"><span>{formatDate(item.documentDate)}</span><span>{item.sectionTitle}</span>{item.pageNumber && <span>Page {item.pageNumber}</span>}<span>Quality {item.sourceQuality}</span></div></div>
              <div className="review-actions"><button className={item.reviewStatus === "accepted" ? "active accept" : ""} onClick={(event) => { event.stopPropagation(); void updateReview([item.id], "accepted"); }} aria-label="Accept evidence" title="Accept evidence"><Check size={15} /></button><button className={item.reviewStatus === "rejected" ? "active reject" : ""} onClick={(event) => { event.stopPropagation(); void updateReview([item.id], "rejected"); }} aria-label="Reject evidence" title="Reject evidence"><X size={15} /></button></div>
            </article>)}
            {!filtered.length && <div className="workspace-state"><Search size={22} /><strong>No matching evidence</strong><span>Adjust the filters to widen the evidence set.</span></div>}
            {visibleItems.length < filtered.length && <button className="load-more-evidence" onClick={() => setVisibleLimit((current) => current + 100)}>Show 100 more <span>{filtered.length - visibleItems.length} remaining</span></button>}
          </div>}
        </section>

        <aside className="source-context panel">
          <div className="catalog-heading"><div><h2>Source context</h2><span>Claim-to-evidence record</span></div>{selected && <span className={`review-badge ${selected.reviewStatus}`}>{selected.reviewStatus}</span>}</div>
          {selected ? <div className="source-context-body">
            <div className="source-identity"><span className="source-kind-icon"><BookOpenText size={18} /></span><div><span>{selected.sourceType}</span><h3>{selected.documentTitle}</h3><p>{selected.companyName} ({selected.ticker}) · {formatDate(selected.documentDate)}</p></div></div>
            <dl><div><dt>Topic</dt><dd>{selected.topic}</dd></div><div><dt>Section</dt><dd>{selected.sectionTitle}</dd></div><div><dt>Location</dt><dd>{selected.pageNumber ? `Page ${selected.pageNumber}` : "Filing section"}</dd></div><div><dt>Quality</dt><dd>{selected.sourceQuality}/100</dd></div></dl>
            <blockquote>{selected.excerpt}</blockquote>
            <p className="provenance-note"><ShieldCheck size={14} /> This excerpt is stored with its source document, section, date, and exact passage identifier.</p>
            <div className="source-context-actions"><button className="command-button" disabled={updating} onClick={() => void updateReview([selected.id], "rejected")}><X size={14} /> Reject</button><button className="primary-button" disabled={updating} onClick={() => void updateReview([selected.id], "accepted")}><Check size={14} /> Accept evidence</button></div>
            <a className="source-document-link" href={selected.pageNumber ? `${selected.sourceUrl}#page=${selected.pageNumber}` : selected.sourceUrl} target="_blank" rel="noreferrer">Open original source <ExternalLink size={14} /></a>
          </div> : <div className="workspace-state"><BookOpenText size={24} /><strong>Select a passage</strong><span>Inspect the original context before accepting it for memo generation.</span></div>}
        </aside>
      </div>
    </div>
  );
}
