"use client";

import { ChevronRight, ExternalLink, FileText, Layers3 } from "lucide-react";
import { LIVE_THEME, TRACKED_COMPANIES, themeGroups } from "@/app/terminal-navigation";

export type ThemeResearchView = {
  isCovered: boolean;
  recent: Array<{ title: string; source: string; age: string; sourceUrl?: string }>;
  confidence: number;
  quality: number;
};

type Props = {
  selectedTheme: string;
  activeThemeGroup: string;
  researchView: ThemeResearchView;
  sourceStatus: { tone: string; label: string };
  onDomainSelect: (domain: string) => void;
  onThemeSelect: (theme: string) => void;
  onNavigate: (path: string) => void;
};

function ScoreGauge({ score, label }: { score: number; label: string }) {
  return <div className="score-block"><p className="eyebrow">{label}</p><div className="gauge" style={{ "--score": `${score * 1.8}deg` } as React.CSSProperties}><div><strong>{score}</strong><span>/100</span></div></div><span className="score-label">Coverage diagnostic</span></div>;
}

export function ThemeRoadmapWorkspace(props: Props) {
  const activeGroup = themeGroups.find((group) => group.title === props.activeThemeGroup) ?? themeGroups[1];
  return <div className="dashboard">
    <div className="title-row"><div><p className="breadcrumb">Research workspace / Roadmap</p><h1>Infrastructure Coverage Roadmap</h1></div><div className={`live-status ${props.sourceStatus.tone}`}><span />{props.sourceStatus.label}</div></div>
    <section className="primary-grid roadmap-primary-grid">
      <article className="panel themes-panel">
        <div className="panel-heading"><div><span className="section-kicker">Coverage universe</span><h2>Infrastructure Themes</h2></div><span className="theme-panel-summary"><i className="coverage-dot live" /> 1 live <b>24 themes · 6 domains</b></span></div>
        <div className="theme-map"><div className="theme-browser">
          <nav className="theme-domain-nav" aria-label="Infrastructure domains">{themeGroups.map((group) => <button key={group.title} className={`${props.activeThemeGroup === group.title ? "active" : ""} ${(group.items as readonly string[]).includes(props.selectedTheme) ? "contains-selection" : ""}`} onClick={() => props.onDomainSelect(group.title)} aria-pressed={props.activeThemeGroup === group.title}><group.icon size={17} strokeWidth={1.7} /><span><strong>{group.title}</strong><small>{group.items.length} themes</small></span><i aria-hidden="true" /></button>)}</nav>
          <section className="theme-domain-detail" aria-label={`${activeGroup.title} themes`}><header><div><span className="section-kicker">Active domain</span><h3>{activeGroup.title}</h3></div><span>{activeGroup.items.length} themes</span></header><div className="theme-options">{activeGroup.items.map((theme) => <button key={theme} className={`${props.selectedTheme === theme ? "selected" : ""} ${theme === LIVE_THEME ? "covered" : "roadmap"}`} onClick={() => props.onThemeSelect(theme)} aria-pressed={props.selectedTheme === theme}><i className={`coverage-dot ${theme === LIVE_THEME ? "live" : "roadmap"}`} /><span><strong>{theme}</strong><small>{theme === LIVE_THEME ? "Live research" : "Planned coverage"}</small></span><ChevronRight size={15} /></button>)}</div><footer><span><i className="coverage-dot live" /> Live coverage</span><span><i className="coverage-dot roadmap" /> Planned coverage</span><strong>Selected: {props.selectedTheme}</strong></footer></section>
        </div></div>
      </article>

      <article className="panel research-panel">
        <div className="research-header"><div><span className="section-kicker">Selected theme</span><h2>{props.selectedTheme}</h2></div><div className="research-header-actions"><span className={`theme-badge ${props.researchView.isCovered ? "live" : "roadmap"}`}>{props.researchView.isCovered ? "Live coverage" : "Roadmap"}</span>{props.researchView.isCovered && <button className="text-link" onClick={() => props.onNavigate("/companies")}>Open research <ChevronRight size={14} /></button>}</div></div>
        <div className="research-content">{!props.researchView.isCovered ? <div className="tab-placeholder coverage-placeholder"><span className="tab-icon"><Layers3 size={22} /></span><h3>{props.selectedTheme} is on the research roadmap</h3><p>No companies, evidence, scores, or generated conclusions are shown until this theme has configured official sources and passes the same provenance policy as Neoclouds.</p><button onClick={() => props.onThemeSelect(LIVE_THEME)}>Open live Neocloud coverage</button></div> : <>
          <div className="recent-column"><h3>Recent evidence</h3>{props.researchView.recent.map((item) => <a className="evidence-item" href={item.sourceUrl} key={item.title} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{item.title}</strong><em>{item.source}</em></span><time>{item.age}</time><ExternalLink className="source-external" size={12} /></a>)}<button className="text-link" onClick={() => props.onNavigate("/evidence")}>View all evidence <ChevronRight size={15} /></button></div>
          <div className="thesis-column"><h3>Key companies</h3><div className="company-tags">{TRACKED_COMPANIES.map((company) => <button key={company.id} onClick={() => props.onNavigate(`/companies/${company.id}`)}>{company.name} ({company.ticker})</button>)}</div><div className="thesis-copy"><h3>Coverage policy</h3><p>This view describes official-source availability and analyst-reviewed research inputs. It does not generate an investment thesis for themes that have not passed the provenance policy.</p><h3>Next research step</h3><p>Open company research to review evidence-backed claims, risks, metrics, and unanswered questions.</p></div></div>
          <div className="scores-column"><ScoreGauge score={props.researchView.confidence} label="Coverage completeness" /><ScoreGauge score={props.researchView.quality} label="Catalog source rating" /><button className="text-link" onClick={() => props.onNavigate("/evidence")}>Review inputs <ChevronRight size={14} /></button></div>
        </>}</div>
      </article>
    </section>
  </div>;
}
