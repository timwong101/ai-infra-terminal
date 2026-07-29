"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, BookOpenText, Check, ChevronRight, Copy, ExternalLink, FileText, Globe2, LoaderCircle, Scale, Share2, ShieldCheck, Sparkles, X } from "lucide-react";
import { MemoReviewWorkflow, type ClaimCommentTarget } from "@/app/components/memo-review-workflow";
import type { ComparisonMemo, EvidenceWorkspaceResponse } from "@/lib/research/types";
import type { PublishedReport, PublishedReportSummary } from "@/lib/reports/types";
import type { MemoReview, MemoReviewWorkspace } from "@/lib/reviews/types";

type Props = {
  initialMemoId?: string;
  onMemoSelect?: (memoId: string) => void;
  onReviewEvidence: () => void;
};

function scoreTone(score: number) { return score >= 75 ? "high" : score >= 55 ? "medium" : "low"; }

export function ComparisonWorkspace({ initialMemoId = "", onMemoSelect, onReviewEvidence }: Props) {
  const initialMemoIdRef = useRef(initialMemoId);
  const [evidence, setEvidence] = useState<EvidenceWorkspaceResponse | null>(null);
  const [memos, setMemos] = useState<ComparisonMemo[]>([]);
  const [selectedMemo, setSelectedMemo] = useState<ComparisonMemo | null>(null);
  const [companyA, setCompanyA] = useState("");
  const [companyB, setCompanyB] = useState("");
  const [topic, setTopic] = useState("All topics");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "generating" | "error">("loading");
  const [error, setError] = useState("");
  const [reports, setReports] = useState<PublishedReportSummary[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [complianceMode, setComplianceMode] = useState(true);
  const [publishStatus, setPublishStatus] = useState<"idle" | "publishing" | "revoking">("idle");
  const [publishNotice, setPublishNotice] = useState("");
  const [copiedReportId, setCopiedReportId] = useState("");
  const [reviewWorkspace, setReviewWorkspace] = useState<MemoReviewWorkspace | null>(null);
  const [commentTarget, setCommentTarget] = useState<ClaimCommentTarget>(null);

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
      setSelectedMemo(loadedMemos.find((memo) => memo.id === initialMemoIdRef.current) ?? loadedMemos[0] ?? null);
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

  useEffect(() => {
    if (!initialMemoId || selectedMemo?.id === initialMemoId) return;
    const routedMemo = memos.find((memo) => memo.id === initialMemoId);
    if (!routedMemo) return;
    let active = true;
    queueMicrotask(() => { if (active) setSelectedMemo(routedMemo); });
    return () => { active = false; };
  }, [initialMemoId, memos, selectedMemo?.id]);

  useEffect(() => {
    if (!selectedMemo) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/published-reports?memoId=${encodeURIComponent(selectedMemo.id)}`, { cache: "no-store", signal: controller.signal }),
      fetch(`/api/memo-reviews?memoId=${encodeURIComponent(selectedMemo.id)}`, { cache: "no-store", signal: controller.signal }),
    ]).then(async ([reportsResponse, reviewResponse]) => {
      const reportsResult = await reportsResponse.json() as { reports?: PublishedReportSummary[]; error?: string };
      const reviewResult = await reviewResponse.json() as MemoReviewWorkspace & { error?: string };
      if (!reportsResponse.ok) throw new Error(reportsResult.error || "Unable to load published versions.");
      if (!reviewResponse.ok) throw new Error(reviewResult.error || "Unable to load memo review.");
      setReports(reportsResult.reports ?? []);
      setReviewWorkspace(reviewResult);
    })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setPublishNotice(cause instanceof Error ? cause.message : "Unable to load memo workflow.");
      });
    return () => controller.abort();
  }, [selectedMemo]);

  const acceptedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of evidence?.items ?? []) if (item.reviewStatus === "accepted" && item.evidenceQualityScore >= 45 && item.boilerplateRisk < 60 && (topic === "All topics" || item.topic === topic)) counts.set(item.companyId, (counts.get(item.companyId) ?? 0) + 1);
    return counts;
  }, [evidence, topic]);

  const generate = async (memo?: ComparisonMemo) => {
    setStatus("generating"); setError("");
    try {
      const payload = memo ? { companyAId: memo.companyA.id, companyBId: memo.companyB.id, topic: memo.topic, question: memo.question } : { companyAId: companyA, companyBId: companyB, topic, question };
      const response = await fetch("/api/comparison-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { memo?: ComparisonMemo; error?: string };
      if (!response.ok || !result.memo) throw new Error(result.error || "Unable to generate memo.");
      setMemos((current) => [result.memo!, ...current]);
      setSelectedMemo(result.memo);
      onMemoSelect?.(result.memo.id);
      setStatus("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to generate memo."); setStatus("ready"); }
  };

  const citationIndex = useMemo(() => new Map(selectedMemo?.citations.map((item, index) => [item.id, index + 1]) ?? []), [selectedMemo]);
  const companyName = (id: string) => id === selectedMemo?.companyA.id ? selectedMemo.companyA.name : selectedMemo?.companyB.name ?? id;
  const activeReports = reports.filter((report) => !report.revokedAt);
  const latestReport = activeReports[0] ?? null;

  const reviewChanged = (review: MemoReview, nextStatus?: ComparisonMemo["status"]) => {
    setReviewWorkspace((current) => current ? { ...current, review } : current);
    if (!nextStatus) return;
    setSelectedMemo((current) => current ? { ...current, status: nextStatus } : current);
    setMemos((current) => current.map((memo) => memo.id === selectedMemo?.id ? { ...memo, status: nextStatus } : memo));
  };

  const publish = async () => {
    if (!selectedMemo) return;
    setPublishStatus("publishing");
    setPublishNotice("");
    try {
      const response = await fetch("/api/published-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoId: selectedMemo.id, complianceMode }),
      });
      const result = await response.json() as { report?: PublishedReport; error?: string };
      if (!response.ok || !result.report) throw new Error(result.error || "Unable to publish this report.");
      setReports((current) => [result.report!, ...current]);
      setSelectedMemo((current) => current ? { ...current, status: "published" } : current);
      setPublishNotice(`Version ${result.report.version} is live.`);
      setPublishOpen(false);
    } catch (cause) {
      setPublishNotice(cause instanceof Error ? cause.message : "Unable to publish this report.");
    } finally {
      setPublishStatus("idle");
    }
  };

  const revoke = async (report: PublishedReportSummary) => {
    setPublishStatus("revoking");
    setPublishNotice("");
    try {
      const response = await fetch(`/api/published-reports/${encodeURIComponent(report.id)}`, { method: "DELETE" });
      const result = await response.json() as { report?: PublishedReportSummary; error?: string };
      if (!response.ok || !result.report) throw new Error(result.error || "Unable to revoke this report.");
      setReports((current) => current.map((item) => item.id === report.id ? result.report! : item));
      setPublishNotice(`Version ${report.version} was revoked.`);
    } catch (cause) {
      setPublishNotice(cause instanceof Error ? cause.message : "Unable to revoke this report.");
    } finally {
      setPublishStatus("idle");
    }
  };

  const copyReportLink = async (report: PublishedReportSummary) => {
    await navigator.clipboard.writeText(`${window.location.origin}${report.path}`);
    setCopiedReportId(report.id);
    window.setTimeout(() => setCopiedReportId(""), 1800);
  };

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
          <div className="saved-memos"><div className="saved-heading"><h3>Research history</h3><span>{memos.length}</span></div>{memos.map((memo) => <button className={`${selectedMemo?.id === memo.id ? "active" : ""} ${memo.isStale ? "stale" : ""}`} data-memo-id={memo.id} onClick={() => { setSelectedMemo(memo); onMemoSelect?.(memo.id); }} key={memo.id}>{memo.isStale ? <AlertTriangle size={15} /> : <FileText size={15} />}<span><strong>{memo.title}</strong><small>{memo.isStale ? "Evidence changed · regeneration needed" : `${memo.topic} · ${memo.citations.length} citations`}</small></span><ChevronRight size={14} /></button>)}{!memos.length && <p>No saved comparison memos yet.</p>}</div>
        </aside>

        <section className={`memo-document panel ${selectedMemo ? `status-${selectedMemo.status}` : ""}`}>
          {selectedMemo ? <>{selectedMemo.isStale && <div className="stale-research-banner memo-stale-banner"><AlertTriangle size={15} /><div><strong>Saved evidence is stale</strong><span>{selectedMemo.staleReason}</span></div><button className="command-button small" disabled={status === "generating"} onClick={() => void generate(selectedMemo)}>{status === "generating" ? <LoaderCircle className="drawer-spinner" size={14} /> : <Sparkles size={14} />} Regenerate</button></div>}
            <header className="memo-document-header"><div><span className="section-kicker">Saved evidence snapshot</span><h2>{selectedMemo.title}</h2><p>{selectedMemo.question}</p></div><div className="memo-header-actions"><div className="memo-run-badges"><span className="draft-badge">{selectedMemo.status.replaceAll("_", " ")}</span>{selectedMemo.generation && <><span className="draft-badge">{selectedMemo.generation.engine.replaceAll("-", " ")}</span><span className="draft-badge">{selectedMemo.generation.retrievalMode}</span><span className={`draft-badge claim-check-badge ${selectedMemo.generation.verification.synthesisFallbackClaims ? "fallback" : ""}`}>{selectedMemo.generation.verification.synthesisFallbackClaims ? `${selectedMemo.generation.verification.synthesisFallbackClaims} source fallback${selectedMemo.generation.verification.synthesisFallbackClaims === 1 ? "" : "s"}` : "Claim checks passed"}</span></>}</div><button className="primary-button publish-report-button" onClick={() => { setPublishOpen(true); setPublishNotice(""); }}><Share2 size={15} />Publish report</button></div></header>
            <MemoReviewWorkflow
              memo={selectedMemo}
              workspace={reviewWorkspace}
              commentTarget={commentTarget}
              onCommentTarget={setCommentTarget}
              onReviewChange={reviewChanged}
            />
            {(latestReport || publishNotice) && <section className="published-version-bar">
              <div><Globe2 size={15} /><span><strong>{latestReport ? `Version ${latestReport.version} published` : "Publishing update"}</strong><small>{publishNotice || (latestReport ? `${latestReport.complianceMode ? "Compliance mode" : "Standard"} · Evidence as of ${latestReport.asOfDate}` : "")}</small></span></div>
              {latestReport && <div><button className="icon-button" onClick={() => void copyReportLink(latestReport)} aria-label="Copy published report link" title="Copy published report link">{copiedReportId === latestReport.id ? <Check size={14} /> : <Copy size={14} />}</button><a className="command-button small" href={latestReport.path} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open report</a></div>}
            </section>}
            <section className="memo-score-strip"><div><span>Confidence</span><strong className={scoreTone(selectedMemo.confidenceScore)}>{selectedMemo.confidenceScore}</strong></div><div><span>Evidence quality</span><strong>{selectedMemo.evidenceQualityScore}</strong></div><div><span>Source diversity</span><strong>{selectedMemo.sourceDiversityScore}</strong></div><div><span>Citations</span><strong>{selectedMemo.citations.length}</strong></div></section>
            {!!selectedMemo.metricSnapshot?.length && <section className="memo-metric-snapshot"><header><div><span className="section-kicker">Analyst-verified fundamentals</span><h3>KPI snapshot</h3></div><small>{selectedMemo.metricSnapshot.length} accepted observations</small></header><div>{selectedMemo.metricSnapshot.map((metric) => <a href={metric.sourceUrl ?? undefined} target={metric.sourceUrl ? "_blank" : undefined} rel="noreferrer" key={metric.id}><span>{metric.ticker} · {metric.label}</span><strong>{metric.displayValue}</strong><small>{metric.periodLabel} · {metric.sourceLabel}</small></a>)}</div></section>}
            <div className="memo-document-body">
              {selectedMemo.sections.map((section) => <section className="grounded-section" key={section.key}><h3>{section.title}</h3>{section.claims.length ? <div className="grounded-claims">{section.claims.map((claim, index) => <article key={`${claim.companyId}-${index}`}><header><span>{companyName(claim.companyId)}</span>{claim.representation && claim.representation !== "question" && <em className={claim.synthesisStatus === "source-fallback" ? "fallback" : ""}>{claim.synthesisStatus === "source-fallback" ? "Source fallback" : claim.representation === "quote" ? "Source quote" : "Verified paraphrase"}</em>}</header><p>{claim.text} {claim.citationIds.map((id) => <a href={`#citation-${citationIndex.get(id)}`} key={id}>[{citationIndex.get(id)}]</a>)}</p>{claim.whyItMatters && <div className="claim-rationale"><strong>Why it matters</strong><span>{claim.whyItMatters}</span></div>}</article>)}</div> : <p className="missing-evidence">No accepted evidence matched this section. Treat it as an explicit research gap.</p>}</section>)}
              <section className="memo-citations"><h3>Evidence packet</h3>{selectedMemo.citations.map((citation, index) => <article id={`citation-${index + 1}`} key={citation.id}><b>{index + 1}</b><div><strong>{citation.companyName} · {citation.sourceType}</strong><p>{citation.excerpt}</p><span>{citation.documentTitle} · {citation.documentDate}{citation.pageNumber ? ` · Page ${citation.pageNumber}` : ""}</span></div><a href={citation.pageNumber ? `${citation.sourceUrl}#page=${citation.pageNumber}` : citation.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open citation ${index + 1}`}><ExternalLink size={14} /></a></article>)}</section>
            </div>
          </> : <div className="workspace-state full"><Scale size={28} /><strong>No memo selected</strong><span>Accept evidence for two companies, then generate a grounded comparison.</span><button className="command-button" onClick={onReviewEvidence}>Review evidence</button></div>}
        </section>
      </div>
      {publishOpen && selectedMemo && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPublishOpen(false); }}>
        <section className="modal publish-report-modal" role="dialog" aria-modal="true" aria-labelledby="publish-report-title">
          <header className="modal-heading"><div><span className="section-kicker">Immutable research version</span><h2 id="publish-report-title">Publish research report</h2></div><button className="icon-button" onClick={() => setPublishOpen(false)} aria-label="Close publish report"><X size={16} /></button></header>
          <div className="publish-report-summary"><FileText size={20} /><span><strong>{selectedMemo.title}</strong><small>Version {reports.length + 1} · {selectedMemo.sections.reduce((sum, section) => sum + section.claims.length, 0)} draft claims · {selectedMemo.citations.length} citations</small></span></div>
          <label className="publish-compliance-option"><input type="checkbox" checked={complianceMode} onChange={(event) => setComplianceMode(event.target.checked)} /><i><ShieldCheck size={15} /></i><span><strong>Compliance mode</strong><small>Publish only same-company, citation-verified claims. Stale claims are withheld.</small></span></label>
          {selectedMemo.isStale && <div className="publish-stale-warning"><AlertTriangle size={15} /><span><strong>Source memo is stale</strong>Compliance mode will withhold factual claims. Regenerate the memo for a complete report.</span></div>}
          {!!reports.length && <section className="published-version-history"><header><span>Version history</span><strong>{activeReports.length} live</strong></header>{reports.slice(0, 5).map((report) => <article className={report.revokedAt ? "revoked" : ""} key={report.id}><span><strong>Version {report.version}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(report.publishedAt))} · {report.complianceMode ? "Compliance" : "Standard"}</small></span>{report.revokedAt ? <em>Revoked</em> : <div><a href={report.path} target="_blank" rel="noreferrer" aria-label={`Open report version ${report.version}`}><ExternalLink size={14} /></a><button disabled={publishStatus !== "idle"} onClick={() => void revoke(report)} aria-label={`Revoke report version ${report.version}`} title={`Revoke report version ${report.version}`}><Ban size={14} /></button></div>}</article>)}</section>}
          {publishNotice && <p className="publish-report-notice">{publishNotice}</p>}
          <footer className="modal-actions"><button className="command-button" onClick={() => setPublishOpen(false)}>Cancel</button><button className="primary-button" disabled={publishStatus !== "idle"} onClick={() => void publish()}>{publishStatus === "publishing" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Globe2 size={15} />}{publishStatus === "publishing" ? "Publishing" : `Publish version ${reports.length + 1}`}</button></footer>
        </section>
      </div>}
    </div>
  );
}
