"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, Check, CircleGauge, Copy, ExternalLink, FileCheck2, Filter, Link2, LoaderCircle, Search, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import type { EvidenceReviewStatus, EvidenceWorkspaceResponse, ResearchEvidenceItem } from "@/lib/research/types";

type Props = { onBuildComparison: () => void };

const EMPTY_RESPONSE: EvidenceWorkspaceResponse = {
  items: [], total: 0, summary: { unreviewed: 0, accepted: 0, rejected: 0 }, companies: [], topics: [], claims: [],
  qualitySummary: { highValue: 0, boilerplateRisk: 0, pendingSuggestions: 0, duplicatePassages: 0 }, synced: { sec: 0, ir: 0 },
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
  const [triage, setTriage] = useState("review");
  const [selected, setSelected] = useState<ResearchEvidenceItem | null>(null);
  const [claimId, setClaimId] = useState("");
  const [claimImpact, setClaimImpact] = useState<"supports" | "weakens" | "watch">("watch");
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

  const selectEvidence = (item: ResearchEvidenceItem) => {
    setSelected(item);
    setClaimId(item.suggestedClaimId ?? "");
    setClaimImpact(item.suggestedImpact ?? "watch");
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.items.filter((item) =>
      (!normalized || [item.companyName, item.ticker, item.documentTitle, item.sectionTitle, item.topic, item.excerpt].join(" ").toLowerCase().includes(normalized)) &&
      (!company || item.companyId === company) &&
      (!topic || item.topic === topic) &&
      (!source || item.sourceKind === source) &&
      (!review || item.reviewStatus === review) &&
      (triage === "all" ||
        (triage === "review" && (item.reviewStatus === "unreviewed" || Boolean(item.suggestedClaimId && item.suggestionStatus === "pending"))) ||
        (triage === "high-value" && item.evidenceQualityScore >= 70 && item.boilerplateRisk < 40) ||
        (triage === "boilerplate" && item.boilerplateRisk >= 60) ||
        (triage === "duplicates" && item.duplicateCount > 1))
    ).sort((left, right) => right.evidenceQualityScore - left.evidenceQualityScore || right.documentDate.localeCompare(left.documentDate));
  }, [company, data.items, query, review, source, topic, triage]);
  const visibleItems = filtered.slice(0, visibleLimit);

  const updateReview = async (ids: string[], nextStatus: EvidenceReviewStatus, suggestion?: { status: "accepted" | "rejected"; claimId?: string; impact?: "supports" | "weakens" | "watch" }) => {
    if (!ids.length) return;
    setUpdating(true);
    try {
      const response = await fetch("/api/research-evidence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: nextStatus, suggestion }),
      });
      const result = await response.json() as { updated?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to update evidence.");
      await load();
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update evidence.");
    } finally {
      setUpdating(false);
    }
  };

  const resetFilters = () => { setQuery(""); setCompany(""); setTopic(""); setSource(""); setReview(""); setTriage("review"); setVisibleLimit(100); };

  return (
    <div className="research-workspace evidence-workspace-page">
      <header className="workspace-title-row">
        <div><p className="breadcrumb">Research workspace / Provenance</p><h1>Evidence Review</h1><p className="workspace-subtitle">Triage material passages, approve claim links, and keep generated research current.</p></div>
        <button className="primary-button" onClick={onBuildComparison}><FileCheck2 size={16} /> Build comparison</button>
      </header>

      <section className="evidence-metrics" aria-label="Evidence review summary">
        <article><span>High-value evidence</span><strong>{data.qualitySummary.highValue}</strong><small>Material and infrastructure-relevant</small></article>
        <article><span>Pending claim links</span><strong>{data.qualitySummary.pendingSuggestions}</strong><small>Analyst decision required</small></article>
        <article><span>Boilerplate risk</span><strong>{data.qualitySummary.boilerplateRisk}</strong><small>Suggested for rejection</small></article>
        <article><span>Duplicate passages</span><strong>{data.qualitySummary.duplicatePassages}</strong><small>Grouped across source packets</small></article>
      </section>

      <section className="evidence-toolbar" aria-label="Evidence filters">
        <label className="workspace-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(100); }} placeholder="Search passages, topics, companies..." />{query && <button onClick={() => { setQuery(""); setVisibleLimit(100); }} aria-label="Clear search"><X size={14} /></button>}</label>
        <select aria-label="Filter evidence triage" value={triage} onChange={(event) => { setTriage(event.target.value); setVisibleLimit(100); }}><option value="review">Analyst review queue</option><option value="high-value">High-value evidence</option><option value="boilerplate">Boilerplate risk</option><option value="duplicates">Duplicate groups</option><option value="all">All evidence</option></select>
        <select aria-label="Filter by company" value={company} onChange={(event) => { setCompany(event.target.value); setVisibleLimit(100); }}><option value="">All companies</option>{data.companies.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.ticker}) · {item.evidenceCount}</option>)}</select>
        <select aria-label="Filter by topic" value={topic} onChange={(event) => { setTopic(event.target.value); setVisibleLimit(100); }}><option value="">All topics</option>{data.topics.map((item) => <option value={item.name} key={item.name}>{item.name} · {item.evidenceCount}</option>)}</select>
        <select aria-label="Filter by source" value={source} onChange={(event) => { setSource(event.target.value); setVisibleLimit(100); }}><option value="">SEC + IR</option><option value="sec">SEC filings</option><option value="ir">Investor relations</option></select>
        <select aria-label="Filter by review status" value={review} onChange={(event) => { setReview(event.target.value); setVisibleLimit(100); }}><option value="">All review states</option><option value="unreviewed">Unreviewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select>
        <button className="icon-button" onClick={resetFilters} aria-label="Reset evidence filters" title="Reset filters"><Filter size={15} /></button>
      </section>

      <div className="evidence-review-layout">
        <section className="evidence-catalog panel">
          <div className="catalog-heading"><div><h2>Analyst review inbox</h2><span>{visibleItems.length} of {filtered.length} prioritized</span></div><span className="quality-engine-label"><Sparkles size={13} /> Deterministic quality v1</span></div>
          {status === "loading" && <div className="workspace-state"><LoaderCircle className="drawer-spinner" size={24} /><strong>Building unified evidence catalog</strong><span>Normalizing SEC and IR passages with source provenance.</span></div>}
          {status === "error" && <div className="workspace-state error"><strong>Evidence workspace unavailable</strong><span>{error}</span><button className="command-button" onClick={() => void load()}>Try again</button></div>}
          {status === "ready" && <div className="evidence-catalog-list">
            {visibleItems.map((item) => <article className={`catalog-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} tabIndex={0} onClick={() => selectEvidence(item)} onKeyDown={(event) => { if (event.key === "Enter") selectEvidence(item); }}>
              <div className="catalog-row-main"><div className="catalog-badges"><span className={`review-badge ${item.reviewStatus}`}>{item.reviewStatus}</span><span>{item.sourceType}</span><span>{item.topic}</span>{item.boilerplateRisk >= 60 && <span className="risk-badge">boilerplate {item.boilerplateRisk}</span>}{item.duplicateCount > 1 && <span className="duplicate-badge"><Copy size={10} /> {item.duplicateCount} copies</span>}</div><h3>{item.companyName} <em>{item.ticker}</em></h3><p>{item.excerpt}</p>{item.suggestedClaimTitle && <div className={`claim-suggestion-row ${item.suggestionStatus}`}><Link2 size={12} /><span>{item.suggestedImpact} · {item.suggestedClaimTitle}</span><b>{item.suggestionConfidence}%</b></div>}<div className="catalog-meta"><span>{formatDate(item.documentDate)}</span><span>{item.sectionTitle}</span>{item.pageNumber && <span>Page {item.pageNumber}</span>}<span>Evidence quality {item.evidenceQualityScore}</span></div></div>
              <div className="review-actions"><button className={item.reviewStatus === "accepted" ? "active accept" : ""} onClick={(event) => { event.stopPropagation(); void updateReview([item.id], "accepted"); }} aria-label="Accept evidence" title="Accept evidence"><Check size={15} /></button><button className={item.reviewStatus === "rejected" ? "active reject" : ""} onClick={(event) => { event.stopPropagation(); void updateReview([item.id], "rejected"); }} aria-label="Reject evidence" title="Reject evidence"><X size={15} /></button></div>
            </article>)}
            {!filtered.length && <div className="workspace-state"><Search size={22} /><strong>No matching evidence</strong><span>Adjust the filters to widen the evidence set.</span></div>}
            {visibleItems.length < filtered.length && <button className="load-more-evidence" onClick={() => setVisibleLimit((current) => current + 100)}>Show 100 more <span>{filtered.length - visibleItems.length} remaining</span></button>}
          </div>}
        </section>

        <aside className="source-context panel">
          <div className="catalog-heading"><div><h2>Quality and claim review</h2><span>Human-in-the-loop decision</span></div>{selected && <span className={`review-badge ${selected.reviewStatus}`}>{selected.reviewStatus}</span>}</div>
          {selected ? <div className="source-context-body">
            <div className="source-identity"><span className="source-kind-icon"><BookOpenText size={18} /></span><div><span>{selected.sourceType}</span><h3>{selected.documentTitle}</h3><p>{selected.companyName} ({selected.ticker}) · {formatDate(selected.documentDate)}</p></div></div>
            <div className="quality-score-grid"><div><CircleGauge size={14} /><span>Composite</span><strong>{selected.evidenceQualityScore}</strong></div><div><span>Materiality</span><strong>{selected.materialityScore}</strong></div><div><span>Specificity</span><strong>{selected.specificityScore}</strong></div><div><span>AI relevance</span><strong>{selected.relevanceScore}</strong></div><div className={selected.boilerplateRisk >= 60 ? "risk" : ""}><span>Boilerplate</span><strong>{selected.boilerplateRisk}</strong></div></div>
            <ul className="quality-reasons">{selected.qualityReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {selected.duplicateCount > 1 && <p className="duplicate-notice"><Copy size={13} /> This passage appears in {selected.duplicateCount} source records. Review once before accepting repeated claims.</p>}
            <blockquote>{selected.excerpt}</blockquote>
            <p className="provenance-note"><ShieldCheck size={14} /> Scores prioritize review; only your decision makes a passage memo-eligible or links it to a thesis.</p>
            {selected.suggestedClaimId ? <section className="claim-review-card"><header><div><span>Suggested claim link</span><strong>{selected.suggestionConfidence}% confidence</strong></div><span className={`review-badge ${selected.suggestionStatus}`}>{selected.suggestionStatus}</span></header><p>{selected.suggestionRationale}</p><label>Claim<select value={claimId} onChange={(event) => setClaimId(event.target.value)}>{data.claims.filter((claim) => claim.companyId === selected.companyId).map((claim) => <option value={claim.id} key={claim.id}>{claim.title}</option>)}</select></label><label>Impact<select value={claimImpact} onChange={(event) => setClaimImpact(event.target.value as typeof claimImpact)}><option value="supports">Supports</option><option value="weakens">Weakens</option><option value="watch">Watch</option></select></label><div><button className="command-button" disabled={updating} onClick={() => void updateReview([selected.id], selected.reviewStatus, { status: "rejected" })}><ShieldAlert size={14} /> Reject link</button><button className="primary-button" disabled={updating || !claimId} onClick={() => void updateReview([selected.id], "accepted", { status: "accepted", claimId, impact: claimImpact })}><Link2 size={14} /> Accept + link</button></div></section> : <p className="missing-evidence"><ShieldAlert size={14} /> No claim link is suggested. This passage may still be accepted for memos after analyst review.</p>}
            <div className="source-context-actions"><button className="command-button" disabled={updating} onClick={() => void updateReview([selected.id], "rejected")}><X size={14} /> Reject passage</button><button className="command-button" disabled={updating} onClick={() => void updateReview([selected.id], "accepted")}><Check size={14} /> Accept for memos</button></div>
            <a className="source-document-link" href={selected.pageNumber ? `${selected.sourceUrl}#page=${selected.pageNumber}` : selected.sourceUrl} target="_blank" rel="noreferrer">Open original source <ExternalLink size={14} /></a>
          </div> : <div className="workspace-state"><BookOpenText size={24} /><strong>Select a passage</strong><span>Inspect the original context before accepting it for memo generation.</span></div>}
        </aside>
      </div>
    </div>
  );
}
