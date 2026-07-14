"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, FileText, LoaderCircle, Plus, Target } from "lucide-react";
import type { ThesisDetail } from "@/lib/theses/repository";

export function ThesisWorkspace() {
  const [claims, setClaims] = useState<ThesisDetail[]>([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ companyId: "", title: "", statement: "" });
  const [error, setError] = useState("");
  const load = async () => {
    const response = await fetch("/api/theses", { cache: "no-store" });
    const result = await response.json() as { claims?: ThesisDetail[]; error?: string };
    if (!response.ok || !result.claims) throw new Error(result.error || "Unable to load theses.");
    setClaims(result.claims); setSelected((current) => current || result.claims![0]?.id || ""); setStatus("ready");
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/theses", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json() as { claims?: ThesisDetail[]; error?: string }; if (!response.ok || !result.claims) throw new Error(result.error || "Unable to load theses."); setClaims(result.claims); setSelected(result.claims[0]?.id || ""); setStatus("ready"); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { setError(cause instanceof Error ? cause.message : "Unable to load theses."); setStatus("error"); } });
    return () => controller.abort();
  }, []);
  const active = claims.find((claim) => claim.id === selected) ?? claims[0];
  const companies = useMemo(() => [...new Map(claims.map((claim) => [claim.companyId, { id: claim.companyId, name: claim.companyName, ticker: claim.ticker }])).values()], [claims]);
  const create = async () => {
    setError("");
    const response = await fetch("/api/theses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error || "Unable to create thesis."); return; }
    setShowCreate(false); setForm({ companyId: "", title: "", statement: "" }); await load();
  };
  if (status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading thesis ledger</strong></div></div>;
  return <div className="research-workspace thesis-workspace">
    <header className="workspace-title-row"><div><p className="breadcrumb">Research workspace / Claim ledger</p><h1>Theses</h1><p className="workspace-subtitle">Track what the evidence supports, weakens, and leaves unresolved over time.</p></div><button className="primary-button" onClick={() => setShowCreate((value) => !value)}><Plus size={15} /> New thesis</button></header>
    {showCreate && <section className="thesis-create panel"><select value={form.companyId} onChange={(event) => setForm({ ...form, companyId: event.target.value })}><option value="">Company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name} ({company.ticker})</option>)}</select><input placeholder="Thesis title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /><textarea placeholder="Falsifiable claim statement" value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} /><button className="primary-button" disabled={!form.companyId || !form.title || !form.statement} onClick={() => void create()}>Create</button></section>}
    {error && <div className="builder-error">{error}</div>}
    <section className="thesis-layout">
      <aside className="panel thesis-index"><div className="catalog-heading"><div><h2>Claim ledger</h2><span>{claims.length} tracked claims</span></div><Target size={17} /></div>{claims.map((claim) => <button key={claim.id} className={active?.id === claim.id ? "active" : ""} onClick={() => setSelected(claim.id)}><span>{claim.ticker}</span><div><strong>{claim.title}</strong><small>{claim.evidence.length} linked evidence items</small></div><b>{claim.supportScore}</b></button>)}</aside>
      <article className="panel thesis-detail-panel">{active ? <><header><div><span className="section-kicker">{active.companyName} / {active.theme}</span><h2>{active.title}</h2><p>{active.statement}</p></div><div className={`thesis-big-score ${active.supportScore >= 50 ? "positive" : "negative"}`}><strong>{active.supportScore}</strong><span>support</span></div></header><div className="thesis-history"><div><span>Score history</span><small>{active.snapshots.length} evidence checkpoints</small></div><div className="thesis-bars">{active.snapshots.map((point, index) => <i key={`${point.date}-${index}`} style={{ height: `${Math.max(8, point.supportScore)}%` }} title={`${point.date}: ${point.supportScore}`} />)}</div></div><section className="thesis-evidence-list"><h3>Claim-to-evidence links</h3>{active.evidence.map((item) => <article key={item.id}><span className={`impact-pill ${item.impact}`}>{item.impact === "supports" ? <ArrowUpRight size={12} /> : item.impact === "weakens" ? <ArrowDownRight size={12} /> : <FileText size={12} />}{item.impact} {item.impactScore > 0 ? "+" : ""}{item.impactScore}</span><div><strong>{item.sourceType} · {item.documentTitle}</strong><p>{item.excerpt}</p><small>{item.documentDate} · {item.rationale}</small></div>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={14} /></a>}</article>)}{!active.evidence.length && <p className="missing-evidence">No evidence is linked yet. Accept relevant passages in the evidence workspace, then run the research cycle.</p>}</section></> : <div className="workspace-state full"><Target size={28} /><strong>No claims available</strong></div>}</article>
    </section>
  </div>;
}
