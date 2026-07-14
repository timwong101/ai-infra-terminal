"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpenText, ChevronRight, ExternalLink, FileText, LoaderCircle, Scale, ShieldCheck, Sparkles } from "lucide-react";
import type { ComparisonMemo, EvidenceWorkspaceResponse } from "@/lib/research/types";

type Props = { onReviewEvidence: () => void };

function scoreTone(score: number) { return score >= 75 ? "high" : score >= 55 ? "medium" : "low"; }

export function ComparisonWorkspace({ onReviewEvidence }: Props) {
  const [evidence, setEvidence] = useState<EvidenceWorkspaceResponse | null>(null);
  const [memos, setMemos] = useState<ComparisonMemo[]>([]);
  const [selectedMemo, setSelectedMemo] = useState<ComparisonMemo | null>(null);
  const [companyA, setCompanyA] = useState("");
  const [companyB, setCompanyB] = useState("");
  const [topic, setTopic] = useState("All topics");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "generating" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/research-evidence?sync=0", { cache: "no-store", signal: controller.signal }).then((response) => response.json()),
      fetch("/api/comparison-memos", { cache: "no-store", signal: controller.signal }).then((response) => response.json()),
    ]).then(([evidenceResult, memoResult]) => {
      if (evidenceResult.error) throw new Error(evidenceResult.error);
      setEvidence(evidenceResult as EvidenceWorkspaceResponse);
      const loadedMemos = (memoResult.memos ?? []) as ComparisonMemo[];
      setMemos(loadedMemos);
      setSelectedMemo(loadedMemos[0] ?? null);
      const eligible = (evidenceResult as EvidenceWorkspaceResponse).companies.filter((company) => (evidenceResult as EvidenceWorkspaceResponse).items.some((item) => item.companyId === company.id && item.reviewStatus === "accepted"));
      setCompanyA(eligible[0]?.id ?? "");
      setCompanyB(eligible[1]?.id ?? "");
      if (eligible[0] && eligible[1]) setQuestion(`Compare ${eligible[0].name} and ${eligible[1].name} as AI infrastructure exposure.`);
      setStatus("ready");
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Unable to load comparison workspace.");
      setStatus("error");
    });
    return () => controller.abort();
  }, []);

  const acceptedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of evidence?.items ?? []) if (item.reviewStatus === "accepted" && (topic === "All topics" || item.topic === topic)) counts.set(item.companyId, (counts.get(item.companyId) ?? 0) + 1);
    return counts;
  }, [evidence, topic]);

  const generate = async () => {
    setStatus("generating"); setError("");
    try {
      const response = await fetch("/api/comparison-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyAId: companyA, companyBId: companyB, topic, question }) });
      const result = await response.json() as { memo?: ComparisonMemo; error?: string };
      if (!response.ok || !result.memo) throw new Error(result.error || "Unable to generate memo.");
      setMemos((current) => [result.memo!, ...current]);
      setSelectedMemo(result.memo);
      setStatus("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to generate memo."); setStatus("ready"); }
  };

  const citationIndex = useMemo(() => new Map(selectedMemo?.citations.map((item, index) => [item.id, index + 1]) ?? []), [selectedMemo]);
  const companyName = (id: string) => id === selectedMemo?.companyA.id ? selectedMemo.companyA.name : selectedMemo?.companyB.name ?? id;

  if (status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading comparison workspace</strong></div></div>;

  return (
    <div className="research-workspace comparison-workspace-page">
      <header className="workspace-title-row"><div><p className="breadcrumb">Research workspace / Grounded analysis</p><h1>Comparison Memos</h1><p className="workspace-subtitle">Generate an auditable comparison using accepted evidence only.</p></div><button className="command-button" onClick={onReviewEvidence}><BookOpenText size={16} /> Review evidence</button></header>
      <div className="comparison-layout">
        <aside className="comparison-builder panel">
          <div className="catalog-heading"><div><h2>New comparison</h2><span>Hybrid retrieval · verified citations</span></div><Scale size={17} /></div>
          <div className="builder-form">
            <label>Company A<select value={companyA} onChange={(event) => setCompanyA(event.target.value)}><option value="">Choose company</option>{evidence?.companies.map((company) => <option value={company.id} key={company.id}>{company.name} ({company.ticker}) · {acceptedCounts.get(company.id) ?? 0} accepted</option>)}</select></label>
            <label>Company B<select value={companyB} onChange={(event) => setCompanyB(event.target.value)}><option value="">Choose company</option>{evidence?.companies.map((company) => <option value={company.id} key={company.id}>{company.name} ({company.ticker}) · {acceptedCounts.get(company.id) ?? 0} accepted</option>)}</select></label>
            <label>Evidence topic<select value={topic} onChange={(event) => setTopic(event.target.value)}><option>All topics</option>{evidence?.topics.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
            <label>Research question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} /></label>
            <div className="eligibility-row"><span><ShieldCheck size={13} /> A: {acceptedCounts.get(companyA) ?? 0} eligible</span><span><ShieldCheck size={13} /> B: {acceptedCounts.get(companyB) ?? 0} eligible</span></div>
            {error && <div className="builder-error"><AlertTriangle size={14} /> {error}</div>}
            <button className="primary-button generate-button" disabled={status === "generating" || !companyA || !companyB || companyA === companyB} onClick={() => void generate()}>{status === "generating" ? <LoaderCircle className="drawer-spinner" size={16} /> : <Sparkles size={16} />} Generate grounded memo</button>
          </div>
          <div className="saved-memos"><div className="saved-heading"><h3>Research history</h3><span>{memos.length}</span></div>{memos.map((memo) => <button className={selectedMemo?.id === memo.id ? "active" : ""} onClick={() => setSelectedMemo(memo)} key={memo.id}><FileText size={15} /><span><strong>{memo.title}</strong><small>{memo.topic} · {memo.citations.length} citations</small></span><ChevronRight size={14} /></button>)}{!memos.length && <p>No saved comparison memos yet.</p>}</div>
        </aside>

        <section className="memo-document panel">
          {selectedMemo ? <>
            <header className="memo-document-header"><div><span className="section-kicker">Saved evidence snapshot</span><h2>{selectedMemo.title}</h2><p>{selectedMemo.question}</p></div><div className="memo-run-badges"><span className="draft-badge">Draft</span>{selectedMemo.generation && <><span className="draft-badge">{selectedMemo.generation.engine.replaceAll("-", " ")}</span><span className="draft-badge">{selectedMemo.generation.retrievalMode}</span></>}</div></header>
            <section className="memo-score-strip"><div><span>Confidence</span><strong className={scoreTone(selectedMemo.confidenceScore)}>{selectedMemo.confidenceScore}</strong></div><div><span>Evidence quality</span><strong>{selectedMemo.evidenceQualityScore}</strong></div><div><span>Source diversity</span><strong>{selectedMemo.sourceDiversityScore}</strong></div><div><span>Citations</span><strong>{selectedMemo.citations.length}</strong></div></section>
            <div className="memo-document-body">
              {selectedMemo.sections.map((section) => <section className="grounded-section" key={section.key}><h3>{section.title}</h3>{section.claims.length ? <div className="grounded-claims">{section.claims.map((claim, index) => <article key={`${claim.companyId}-${index}`}><span>{companyName(claim.companyId)}</span><p>{claim.text} {claim.citationIds.map((id) => <a href={`#citation-${citationIndex.get(id)}`} key={id}>[{citationIndex.get(id)}]</a>)}</p></article>)}</div> : <p className="missing-evidence">No accepted evidence matched this section. Treat it as an explicit research gap.</p>}</section>)}
              <section className="memo-citations"><h3>Evidence packet</h3>{selectedMemo.citations.map((citation, index) => <article id={`citation-${index + 1}`} key={citation.id}><b>{index + 1}</b><div><strong>{citation.companyName} · {citation.sourceType}</strong><p>{citation.excerpt}</p><span>{citation.documentTitle} · {citation.documentDate}{citation.pageNumber ? ` · Page ${citation.pageNumber}` : ""}</span></div><a href={citation.pageNumber ? `${citation.sourceUrl}#page=${citation.pageNumber}` : citation.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open citation ${index + 1}`}><ExternalLink size={14} /></a></article>)}</section>
            </div>
          </> : <div className="workspace-state full"><Scale size={28} /><strong>No memo selected</strong><span>Accept evidence for two companies, then generate a grounded comparison.</span><button className="command-button" onClick={onReviewEvidence}>Review evidence</button></div>}
        </section>
      </div>
    </div>
  );
}
