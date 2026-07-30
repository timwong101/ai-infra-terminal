"use client";

import { AlertTriangle, Archive, CheckCircle2, ChevronRight, Database, FileWarning, GitBranch, LoaderCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { ResearchQualityCase, ResearchQualityFeedback } from "@/lib/research/types";

type Props = {
  feedback: ResearchQualityFeedback[];
  cases: ResearchQualityCase[];
  onChanged: () => Promise<void>;
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function ResearchQualityFeedbackWorkspace({ feedback, cases, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState(feedback[0]?.id ?? "");
  const [expectedBehavior, setExpectedBehavior] = useState(feedback[0]?.expectedBehavior ?? "");
  const [expectedCompanyIds, setExpectedCompanyIds] = useState(feedback[0]?.adjudication?.companyIds ?? feedback[0]?.trace.filters.companyIds ?? []);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [notice, setNotice] = useState("");
  const selected = useMemo(() => feedback.find((item) => item.id === selectedId) ?? feedback[0] ?? null, [feedback, selectedId]);

  const selectFeedback = (item: ResearchQualityFeedback) => {
    setSelectedId(item.id);
    setExpectedBehavior(item.expectedBehavior ?? "");
    setExpectedCompanyIds(item.adjudication?.companyIds ?? item.trace.filters.companyIds);
    setNotice("");
  };

  const act = async (action: "adjudicate" | "dismiss" | "promote" | "revise") => {
    if (!selected) return;
    setStatus("saving");
    setNotice("");
    const response = await fetch(`/api/research-quality/feedback/${encodeURIComponent(selected.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedBehavior, companyIds: expectedCompanyIds }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setNotice(result.error ?? "Unable to update this issue.");
      setStatus("idle");
      return;
    }
    await onChanged();
    setNotice(action === "promote"
      ? "Regression case created and added to future quality runs."
      : action === "revise"
        ? "A new case version was created without rewriting prior benchmark history."
        : "Adjudication saved.");
    setStatus("idle");
  };

  return (
    <div className="quality-feedback-layout">
      <aside className="quality-feedback-queue">
        <div className="quality-panel-heading"><div><span className="section-kicker">Analyst reports</span><h2>Failure Queue</h2></div><span>{feedback.filter((item) => item.status === "open").length} open</span></div>
        <div className="quality-feedback-list">
          {feedback.map((item) => <button key={item.id} className={item.id === selected?.id ? "active" : ""} onClick={() => selectFeedback(item)}>
            <span className={`feedback-severity ${item.severity}`} />
            <span><strong>{item.failureType.replaceAll("-", " ")}</strong><small>{item.summary}</small><em>{item.status} · {shortDate(item.createdAt)}</em></span>
            <ChevronRight size={13} />
          </button>)}
          {!feedback.length && <div className="quality-empty"><ShieldCheck size={24} /><strong>No reported failures</strong><span>Issues reported from Research Assistant answers will appear here with their frozen traces.</span></div>}
        </div>
      </aside>

      <section className="quality-feedback-detail">
        {selected ? <>
          <header><div><span className="section-kicker">{selected.failureType.replaceAll("-", " ")} · {selected.severity}</span><h2>{selected.trace.question}</h2></div><span className={`feedback-status ${selected.status}`}>{selected.status}</span></header>
          <div className="quality-trace-summary">
            <div><GitBranch size={14} /><span><small>Prompt and engine</small><strong>{selected.trace.promptVersion}</strong><em>{selected.trace.engine} · {selected.trace.model}</em></span></div>
            <div><Database size={14} /><span><small>Frozen packet</small><strong>{selected.trace.evidenceSnapshot.length} passages</strong><em>{selected.trace.metricSnapshot.length} KPI observations</em></span></div>
            <div><CheckCircle2 size={14} /><span><small>Verification</small><strong>{selected.trace.verification?.passed ? "Passed" : "Review"}</strong><em>{selected.trace.verification?.rejectedClaims ?? 0} rejected claims</em></span></div>
          </div>
          <section className="quality-feedback-report"><h3>Analyst report</h3><p>{selected.summary}</p><small>Reported by {selected.reporter.name} · {shortDate(selected.createdAt)}</small></section>
          <fieldset className="quality-expected-companies" disabled={selected.status === "dismissed"}>
            <legend>Expected company scope</legend>
            {[...new Map(selected.trace.evidenceSnapshot.map((item) => [item.companyId, { id: item.companyId, name: item.companyName, ticker: item.ticker }])).values()].map((company) => <label key={company.id}><input type="checkbox" checked={expectedCompanyIds.includes(company.id)} onChange={() => setExpectedCompanyIds((current) => current.includes(company.id) ? current.filter((id) => id !== company.id) : [...current, company.id])} /><span>{company.ticker}</span><small>{company.name}</small></label>)}
          </fieldset>
          <label className="quality-expected-behavior"><span>Expected behavior</span><textarea rows={4} value={expectedBehavior} disabled={selected.status === "dismissed"} onChange={(event) => setExpectedBehavior(event.target.value)} placeholder="Record the correct answer, evidence requirements, or expected refusal behavior." /></label>
          <details className="quality-packet"><summary><FileWarning size={13} />Original generated answer <ChevronRight size={12} /></summary><pre>{selected.trace.answerMarkdown ?? "No completed answer was produced."}</pre></details>
          <details className="quality-packet"><summary><Database size={13} />Frozen evidence packet <span>{selected.trace.evidenceSnapshot.length}</span><ChevronRight size={12} /></summary><div>{selected.trace.evidenceSnapshot.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer"><strong>{item.companyName} · {item.topic}</strong><small>{item.documentDate} · {item.sourceType}</small><p>{item.excerpt}</p></a>)}</div></details>
          {notice && <div className="quality-feedback-notice">{notice}</div>}
          {selected.status !== "dismissed" && <footer>
            {selected.status !== "promoted" && <>
            <button className="command-button" disabled={status === "saving"} onClick={() => void act("dismiss")}><Archive size={13} /> Dismiss</button>
            <button className="command-button" disabled={status === "saving" || !expectedBehavior.trim()} onClick={() => void act("adjudicate")}>Save adjudication</button>
            <button className="primary-button" disabled={status === "saving" || !expectedBehavior.trim() || !expectedCompanyIds.length} onClick={() => void act("promote")}>{status === "saving" ? <LoaderCircle className="drawer-spinner" size={14} /> : <GitBranch size={14} />} Promote to regression</button>
            </>}
            {selected.status === "promoted" && <button className="primary-button" disabled={status === "saving" || !expectedBehavior.trim() || !expectedCompanyIds.length} onClick={() => void act("revise")}>{status === "saving" ? <LoaderCircle className="drawer-spinner" size={14} /> : <GitBranch size={14} />} Create new version</button>}
          </footer>}
        </> : <div className="quality-empty"><AlertTriangle size={25} /><strong>Failure adjudication</strong><span>Select a reported issue to inspect its immutable generation trace.</span></div>}
      </section>

      <aside className="quality-case-library">
        <div className="quality-panel-heading"><div><span className="section-kicker">Living benchmark</span><h2>Production Cases</h2></div><span>{cases.length}</span></div>
        <div className="quality-case-list">
          {cases.map((item) => <article key={item.id}><span><GitBranch size={13} /></span><div><strong>{item.title}</strong><small>{item.category.replaceAll("-", " ")} · version {item.currentVersion}</small><em>{item.expectations.behavior} · {item.expectations.minimumCitations} minimum citations</em></div></article>)}
          {!cases.length && <div className="quality-empty compact"><GitBranch size={22} /><strong>No production cases yet</strong><span>Promote an adjudicated failure to make it part of every future regression run.</span></div>}
        </div>
      </aside>
    </div>
  );
}
