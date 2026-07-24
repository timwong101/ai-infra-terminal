"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { BookOpenText, Check, ChevronRight, ExternalLink, FileQuestion, History, LoaderCircle, MessageSquareText, Plus, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessageResponse } from "@/app/components/ai-elements/message";
import type { ResearchAssistantFilters, ResearchAssistantMessage, ResearchAssistantSession } from "@/lib/research/types";

type Catalog = {
  companies: Array<{ id: string; name: string; ticker: string }>;
  topics: string[];
  sessions: Array<{ id: string; title: string; updatedAt: string; messageCount: number; lastQuestion: string | null }>;
};

type Props = {
  initialSessionId?: string;
  onSessionSelect: (id: string) => void;
  onOpenMemo: (id: string) => void;
};

const EMPTY_FILTERS: ResearchAssistantFilters = { companyIds: [], topic: "All topics", sourceKinds: [], dateFrom: undefined, dateTo: undefined };

function messageText(message: UIMessage) {
  return message.parts.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n");
}

function scoreTone(value: number | null) {
  return (value ?? 0) >= 75 ? "high" : (value ?? 0) >= 55 ? "medium" : "low";
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

export function ResearchAssistantWorkspace({ initialSessionId = "", onSessionSelect, onOpenMemo }: Props) {
  const creating = useRef(false);
  const filtersRef = useRef<ResearchAssistantFilters>(EMPTY_FILTERS);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<ResearchAssistantSession | null>(null);
  const [filters, setFilters] = useState<ResearchAssistantFilters>(EMPTY_FILTERS);
  const [question, setQuestion] = useState("");
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");

  const loadCatalog = useCallback(async () => {
    const response = await fetch("/api/research-assistant", { cache: "no-store" });
    const result = await response.json() as Catalog | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load research history.");
    setCatalog(result);
    return result;
  }, []);

  const fetchSession = useCallback(async (id: string) => {
    const response = await fetch(`/api/research-assistant/${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json() as { session: ResearchAssistantSession } | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load this research session.");
    return result.session;
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const nextSession = await fetchSession(id);
    setSession(nextSession);
    setFilters(nextSession.filters);
    return nextSession;
  }, [fetchSession]);

  const transport = useMemo(() => new DefaultChatTransport({ api: initialSessionId ? `/api/research-assistant/${encodeURIComponent(initialSessionId)}/messages` : "/api/research-assistant/invalid/messages" }), [initialSessionId]);
  const { messages, sendMessage, setMessages, status, error: chatError, stop } = useChat({
    id: initialSessionId || "new-research-session",
    transport,
    onFinish: async () => {
      if (!initialSessionId) return;
      const [nextSession] = await Promise.all([fetchSession(initialSessionId), loadCatalog()]);
      setSession(nextSession);
      setFilters(nextSession.filters);
      setMessages([]);
    },
  });

  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const createSession = useCallback(async (preferredFilters?: ResearchAssistantFilters) => {
    if (creating.current) return;
    creating.current = true;
    try {
      const response = await fetch("/api/research-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: preferredFilters ?? filtersRef.current }) });
      const result = await response.json() as { id: string } | { error: string };
      if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to create a research session.");
      onSessionSelect(result.id);
    } catch (createError) {
      setNotice(createError instanceof Error ? createError.message : "Unable to create a research session.");
      setLoadStatus("error");
    } finally {
      creating.current = false;
    }
  }, [onSessionSelect]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      Promise.all([loadCatalog(), initialSessionId ? loadSession(initialSessionId) : Promise.resolve(null)])
        .then(([nextCatalog]) => {
          if (cancelled) return;
          if (!initialSessionId) {
            const existing = nextCatalog.sessions[0];
            if (existing) {
              onSessionSelect(existing.id);
            } else {
              const defaults = { ...EMPTY_FILTERS, companyIds: nextCatalog.companies.map((item) => item.id) };
              setFilters(defaults);
              void createSession(defaults);
            }
          }
          setLoadStatus("ready");
        })
        .catch((loadError) => { if (!cancelled) { setNotice(loadError instanceof Error ? loadError.message : "Unable to load the research assistant."); setLoadStatus("error"); } });
    });
    return () => { cancelled = true; };
  }, [createSession, initialSessionId, loadCatalog, loadSession, onSessionSelect]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || status === "submitted" || status === "streaming") return;
    if (!filters.companyIds.length) { setNotice("Select at least one company before asking a question."); return; }
    setNotice("");
    setQuestion("");
    await sendMessage({ text: value }, { body: { filters } });
  };

  const toggleCompany = (id: string) => setFilters((current) => ({ ...current, companyIds: current.companyIds.includes(id) ? current.companyIds.filter((item) => item !== id) : [...current.companyIds, id] }));
  const toggleSource = (kind: "sec" | "ir") => setFilters((current) => ({ ...current, sourceKinds: current.sourceKinds.includes(kind) ? current.sourceKinds.filter((item) => item !== kind) : [...current.sourceKinds, kind] }));
  const latest = session?.messages.at(-1) ?? null;

  const addToMemo = async () => {
    if (!latest || filters.companyIds.length !== 2) return;
    setNotice("Building a comparison memo from the accepted evidence packet...");
    const response = await fetch("/api/comparison-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyAId: filters.companyIds[0], companyBId: filters.companyIds[1], topic: filters.topic, question: latest.question }) });
    const result = await response.json() as { memo?: { id: string }; error?: string };
    if (!response.ok || !result.memo) { setNotice(result.error ?? "Unable to create a memo."); return; }
    onOpenMemo(result.memo.id);
  };

  const createOpenQuestion = async () => {
    const openQuestion = latest?.openQuestions[0];
    if (!openQuestion) return;
    const company = catalog?.companies.find((item) => item.id === openQuestion.companyId);
    const response = await fetch("/api/theses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: openQuestion.companyId, title: `Open question: ${openQuestion.text.slice(0, 70)}`, statement: openQuestion.text }) });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? `Open question saved for ${company?.name ?? openQuestion.companyId}.` : result.error ?? "Unable to save the open question.");
  };

  if (loadStatus === "loading" && !catalog) return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={25} /><strong>Loading research assistant</strong><span>Opening saved questions and evidence controls.</span></div>;
  if (loadStatus === "error" && !catalog) return <div className="workspace-state full-page"><FileQuestion size={25} /><strong>Research assistant unavailable</strong><span>{notice}</span></div>;

  return (
    <div className="research-assistant-workspace">
      <aside className="research-assistant-history">
        <div className="research-assistant-history-heading"><div><span className="section-kicker">Saved work</span><h2>Question History</h2></div><button className="icon-button" onClick={() => void createSession()} title="New research question" aria-label="New research question"><Plus size={16} /></button></div>
        <div className="research-assistant-history-list">
          {catalog?.sessions.map((item) => <button key={item.id} className={item.id === initialSessionId ? "active" : ""} onClick={() => onSessionSelect(item.id)}><History size={14} /><span><strong>{item.title}</strong><small>{item.messageCount} {item.messageCount === 1 ? "answer" : "answers"} · {shortDate(item.updatedAt)}</small></span><ChevronRight size={13} /></button>)}
          {!catalog?.sessions.length && <div className="research-assistant-history-empty">Your saved research questions will appear here.</div>}
        </div>
      </aside>

      <section className="research-assistant-main">
        <header className="research-assistant-title"><div><p className="breadcrumb">Research workspace / Evidence-grounded Q&amp;A</p><h1>Research Assistant</h1><span>Answers are limited to analyst-accepted SEC and investor-relations evidence.</span></div><div className="research-assistant-policy"><ShieldCheck size={16} /><span><strong>Grounded mode</strong>Unsupported claims are rejected</span></div></header>

        <section className="research-assistant-filters" aria-label="Research filters">
          <div className="filter-block companies"><span>Companies</span><div>{catalog?.companies.map((company) => <label key={company.id}><input type="checkbox" checked={filters.companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} /><i>{filters.companyIds.includes(company.id) && <Check size={10} />}</i>{company.ticker}</label>)}</div></div>
          <label className="filter-block"><span>Topic</span><select value={filters.topic} onChange={(event) => setFilters((current) => ({ ...current, topic: event.target.value }))}><option>All topics</option>{catalog?.topics.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
          <div className="filter-block sources"><span>Sources</span><div><button className={!filters.sourceKinds.length ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, sourceKinds: [] }))}>All</button><label><input type="checkbox" checked={filters.sourceKinds.includes("sec")} onChange={() => toggleSource("sec")} />SEC</label><label><input type="checkbox" checked={filters.sourceKinds.includes("ir")} onChange={() => toggleSource("ir")} />IR</label></div></div>
          <label className="filter-block date"><span>From</span><input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value || undefined }))} /></label>
          <label className="filter-block date"><span>To</span><input type="date" value={filters.dateTo ?? ""} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value || undefined }))} /></label>
        </section>

        <div className="research-assistant-conversation">
          {!session?.messages.length && !messages.length && <div className="research-assistant-empty"><span><MessageSquareText size={24} /></span><h2>Ask an evidence-first question</h2><p>Compare business exposure, investigate financing risk, or test whether the accepted source packet supports a thesis.</p><div><button onClick={() => setQuestion("Compare the selected Neoclouds on capacity, demand, and financing risk.")}>Compare exposure</button><button onClick={() => setQuestion("What evidence could weaken the capacity growth thesis?")}>Stress-test a thesis</button></div></div>}

          {session?.messages.map((item) => <SavedAnswer key={item.id} message={item} catalog={catalog} />)}
          {messages.map((message) => <article className={`research-assistant-message ${message.role}`} key={message.id}>{message.role === "user" ? <div className="research-assistant-question"><span>You asked</span><p>{messageText(message)}</p></div> : <div className="research-assistant-answer streaming"><div className="answer-heading"><Sparkles size={16} /><strong>Grounded answer</strong><LoaderCircle className="drawer-spinner" size={14} /></div><MessageResponse mode="streaming">{messageText(message)}</MessageResponse></div>}</article>)}
          {(status === "submitted" && !messages.some((item) => item.role === "assistant")) && <div className="research-assistant-retrieving"><LoaderCircle className="drawer-spinner" size={18} /><span><strong>Retrieving approved evidence</strong>Ranking passages across the selected companies and sources.</span></div>}
        </div>

        <footer className="research-assistant-composer">
          {(notice || chatError) && <div className="research-assistant-notice">{chatError?.message ?? notice}</div>}
          {latest && <div className="research-assistant-actions"><button className="command-button" disabled={filters.companyIds.length !== 2} onClick={() => void addToMemo()}><BookOpenText size={14} /> Add to memo</button><button className="command-button" disabled={!latest.openQuestions.length} onClick={() => void createOpenQuestion()}><FileQuestion size={14} /> Create open question</button><span>{filters.companyIds.length !== 2 ? "Select exactly two companies to create a comparison memo." : "Actions preserve this question and its selected company context."}</span></div>}
          <form onSubmit={submit}><textarea aria-label="Research question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about capacity, customers, financing, compute exposure, risks..." rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type={status === "streaming" || status === "submitted" ? "button" : "submit"} onClick={status === "streaming" || status === "submitted" ? stop : undefined} aria-label={status === "streaming" || status === "submitted" ? "Stop answer" : "Send question"} title={status === "streaming" || status === "submitted" ? "Stop answer" : "Send question"}>{status === "streaming" || status === "submitted" ? <LoaderCircle className="drawer-spinner" size={18} /> : <Send size={17} />}</button></form>
        </footer>
      </section>
    </div>
  );
}

function SavedAnswer({ message, catalog }: { message: ResearchAssistantMessage; catalog: Catalog | null }) {
  return <article className="saved-answer">
    <div className="research-assistant-question"><span>Research question</span><p>{message.question}</p></div>
    <div className="research-assistant-answer">
      <div className="answer-heading"><Sparkles size={16} /><strong>Grounded answer</strong><span>{message.engine.replaceAll("-", " ")}</span></div>
      {message.answerMarkdown ? <MessageResponse>{message.answerMarkdown}</MessageResponse> : <p className="answer-error">{message.error ?? "This answer did not complete."}</p>}
      <div className="research-assistant-scores"><div className={scoreTone(message.confidenceScore)}><span>Confidence</span><strong>{message.confidenceScore ?? 0}</strong></div><div className={scoreTone(message.evidenceQualityScore)}><span>Evidence quality</span><strong>{message.evidenceQualityScore ?? 0}</strong></div><div className={scoreTone(message.sourceDiversityScore)}><span>Source diversity</span><strong>{message.sourceDiversityScore ?? 0}</strong></div><div className={message.verification?.passed ? "high" : "low"}><span>Claim checks</span><strong>{message.verification?.passed ? "Pass" : "Review"}</strong></div></div>
      {!!message.citations.length && <details className="research-assistant-sources"><summary><BookOpenText size={14} /> Evidence packet <span>{message.citations.length} passages</span><ChevronRight size={13} /></summary><div>{message.citations.map((item, index) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer"><b>{index + 1}</b><span><strong>{catalog?.companies.find((company) => company.id === item.companyId)?.name ?? item.companyName} · {item.sourceType}</strong><small>{item.documentDate} · {item.topic} · Quality {item.evidenceQualityScore}</small><em>{item.excerpt}</em></span><ExternalLink size={13} /></a>)}</div></details>}
    </div>
  </article>;
}
