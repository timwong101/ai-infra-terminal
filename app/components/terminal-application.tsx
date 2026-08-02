"use client";

import {
  LoaderCircle,
  Menu,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SignInScreen, UserMenu, type AuthSession, type PublicAuthState } from "@/app/components/auth-controls";
import { EvidenceDetailDrawer, type EvidenceDocument } from "@/app/components/evidence-detail-drawer";
import { NeocloudOverview } from "@/app/components/neocloud-overview";
import { ThemeRoadmapWorkspace, type ThemeResearchView } from "@/app/components/theme-roadmap-workspace";
import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import type {
  EvidenceCache,
  FilingComparison,
  SecEvidenceResponse,
  SecFilingDetail,
  SecFilingDetailResponse,
  SecRefreshStatus,
} from "@/lib/evidence/types";
import { baseFilingForm, getFilingComparisonMode } from "@/lib/evidence/compare";
import type { IrDocumentDetail, IrDocumentDetailResponse, IrEvidenceCache, IrEvidenceResponse } from "@/lib/ir/types";
import {
  LIVE_THEME,
  TRACKED_COMPANIES,
  navigationSectionFor,
  navigationSections,
  parseTerminalRoute,
  resolveAuthPath,
  routeEntitySegment,
  slugify,
  themeGroups,
} from "@/app/terminal-navigation";

const AlertsWorkspace = lazy(() => import("@/app/components/alerts-workspace").then((module) => ({ default: module.AlertsWorkspace })));
const AuditWorkspace = lazy(() => import("@/app/components/audit-workspace").then((module) => ({ default: module.AuditWorkspace })));
const ComparisonWorkspace = lazy(() => import("@/app/components/comparison-workspace").then((module) => ({ default: module.ComparisonWorkspace })));
const CompanyIntelligenceWorkspace = lazy(() => import("@/app/components/company-intelligence-workspace").then((module) => ({ default: module.CompanyIntelligenceWorkspace })));
const EventIntelligenceWorkspace = lazy(() => import("@/app/components/event-intelligence-workspace").then((module) => ({ default: module.EventIntelligenceWorkspace })));
const EvidenceWorkspace = lazy(() => import("@/app/components/evidence-workspace").then((module) => ({ default: module.EvidenceWorkspace })));
const InvitationAcceptance = lazy(() => import("@/app/components/invitation-acceptance").then((module) => ({ default: module.InvitationAcceptance })));
const LineageWorkspace = lazy(() => import("@/app/components/lineage-workspace").then((module) => ({ default: module.LineageWorkspace })));
const OperationsWorkspace = lazy(() => import("@/app/components/operations-workspace").then((module) => ({ default: module.OperationsWorkspace })));
const PublishedReportWorkspace = lazy(() => import("@/app/components/published-report-workspace").then((module) => ({ default: module.PublishedReportWorkspace })));
const ResearchAssistantWorkspace = lazy(() => import("@/app/components/research-assistant-workspace").then((module) => ({ default: module.ResearchAssistantWorkspace })));
const ResearchQualityWorkspace = lazy(() => import("@/app/components/research-quality-workspace").then((module) => ({ default: module.ResearchQualityWorkspace })));
const ResearchReplayWorkspace = lazy(() => import("@/app/components/research-replay-workspace").then((module) => ({ default: module.ResearchReplayWorkspace })));
const ThesisWorkspace = lazy(() => import("@/app/components/thesis-workspace").then((module) => ({ default: module.ThesisWorkspace })));

type SecUiStatus = SecRefreshStatus | "refreshing";

type ResearchView = ThemeResearchView & { coveredCompanyCount: number };

const secEvidenceCache = secEvidenceCacheJson as unknown as EvidenceCache;
const irEvidenceCache = irEvidenceCacheJson as unknown as IrEvidenceCache;

function formatFilingDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}


function createNeocloudResearchView(cache: EvidenceCache, irCache: IrEvidenceCache): ResearchView {
  const secEvidence: EvidenceDocument[] = cache.filings.map((filing) => ({
    source: `SEC ${filing.formType}`,
    company: `${filing.companyName} (${filing.ticker})`,
    claim: filing.summary,
    age: formatFilingDate(filing.filedAt),
    score: filing.sourceQuality,
    signal: filing.signal,
    sourceUrl: filing.sourceUrl,
    accessionNumber: filing.accessionNumber,
    cik: filing.cik,
    primaryDocument: filing.primaryDocument,
    formType: filing.formType,
    filedAt: filing.filedAt,
    isLive: true,
    canExtract: true,
    detailKind: "sec",
  }));
  const irEvidence: EvidenceDocument[] = irCache.documents.map((document) => ({
    source: document.documentType,
    company: `${document.companyName} (${document.ticker})`,
    claim: document.title,
    age: formatFilingDate(document.publishedAt),
    score: document.sourceQuality,
    signal: document.signal,
    sourceUrl: document.sourceUrl,
    accessionNumber: document.id,
    documentId: document.id,
    filedAt: document.publishedAt,
    isLive: true,
    canExtract: true,
    detailKind: "ir",
  }));
  const evidence = [...secEvidence, ...irEvidence].sort((left, right) => (right.filedAt ?? "").localeCompare(left.filedAt ?? ""));
  const recent = evidence.slice(0, 3).map((item) => ({ title: item.claim, source: item.source, age: item.age, sourceUrl: item.sourceUrl }));
  const averageQuality = evidence.length
    ? Math.round(evidence.reduce((total, item) => total + item.score, 0) / evidence.length)
    : 0;
  const coveredTickers = new Set([
    ...cache.filings.map((filing) => filing.ticker),
    ...irCache.documents.map((document) => document.ticker),
  ]);
  const coveredCompanyCount = TRACKED_COMPANIES.filter((company) => coveredTickers.has(company.ticker)).length;

  return {
    isCovered: true,
    recent,
    confidence: Math.round((averageQuality * 0.7) + ((coveredCompanyCount / TRACKED_COMPANIES.length) * 30)),
    quality: averageQuality,
    coveredCompanyCount,
  };
}

function createRoadmapResearchView(): ResearchView {
  return {
    isCovered: false,
    recent: [],
    confidence: 0,
    quality: 0,
    coveredCompanyCount: 0,
  };
}

function findPreviousFiling(evidence: EvidenceDocument, cache: EvidenceCache) {
  const { cik, filedAt, formType } = evidence;
  if (!cik || !filedAt || !formType) return null;
  if (getFilingComparisonMode(formType) === "event") return null;
  const baseForm = baseFilingForm(formType);
  return cache.filings
    .filter((filing) =>
      filing.cik === cik &&
      baseFilingForm(filing.formType) === baseForm &&
      getFilingComparisonMode(filing.formType) !== "amendment" &&
      filing.filedAt < filedAt,
    )
    .sort((left, right) => right.filedAt.localeCompare(left.filedAt))[0] ?? null;
}

function AppLogo() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function TerminalApplication() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [auth, setAuth] = useState<AuthSession | PublicAuthState | null>(null);
  const [publicReportToken, setPublicReportToken] = useState<string | null>(null);

  const loadAuth = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const result = await response.json() as AuthSession | PublicAuthState;
    const nextPath = resolveAuthPath(result.authenticated, pathname, searchParams);
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (currentPath !== nextPath) router.replace(nextPath);
    setAuth(result);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    queueMicrotask(() => {
      const parts = pathname.split("/").filter(Boolean);
      const token = parts.length === 2 && parts[0] === "reports" && /^[a-f0-9]{64}$/.test(parts[1]) ? parts[1] : "";
      setPublicReportToken(token);
      if (!token) void loadAuth();
    });
  }, [loadAuth, pathname]);

  if (publicReportToken === null) return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={25} /><strong>Opening research workspace</strong></div>;
  if (publicReportToken) return <Suspense fallback={<RouteLoading label="Opening published report" />}><PublishedReportWorkspace token={publicReportToken} /></Suspense>;
  if (!auth) return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={25} /><strong>Opening analyst workspace</strong><span>Validating your session and active workspace.</span></div>;
  if (!auth.authenticated) return <SignInScreen state={auth} onSignedIn={loadAuth} />;
  const invitationParts = pathname.split("/").filter(Boolean);
  if (invitationParts.length === 2 && invitationParts[0] === "invite") {
    return <Suspense fallback={<RouteLoading label="Opening invitation" />}><InvitationAcceptance token={invitationParts[1]} auth={auth} onAccepted={loadAuth} /></Suspense>;
  }
  return <Terminal auth={auth} onAuthChange={loadAuth} />;
}

function RouteLoading({ label = "Opening workspace" }: { label?: string }) {
  return <div className="workspace-state full-page route-loading"><LoaderCircle className="drawer-spinner" size={25} /><strong>{label}</strong><span>Loading only the tools required for this view.</span></div>;
}

function Terminal({ auth, onAuthChange }: { auth: AuthSession; onAuthChange: () => Promise<void> }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRoute = parseTerminalRoute(pathname, searchParams);
  const [selectedTheme, setSelectedTheme] = useState(initialRoute.selectedTheme ?? LIVE_THEME);
  const [activeThemeGroup, setActiveThemeGroup] = useState("Cloud & Capacity");
  const [activeNav, setActiveNav] = useState(initialRoute.activeNav);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [liveSecCache, setLiveSecCache] = useState(secEvidenceCache);
  const [liveIrCache, setLiveIrCache] = useState(irEvidenceCache);
  const [secRefreshStatus, setSecRefreshStatus] = useState<SecUiStatus>("refreshing");
  const [sourceStatusMessage, setSourceStatusMessage] = useState("Loading persisted source catalog.");
  const [irRefreshStatus, setIrRefreshStatus] = useState<SecUiStatus>("refreshing");
  const [irSourceStatusMessage, setIrSourceStatusMessage] = useState("Loading IR catalog.");
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDocument | null>(null);
  const [filingDetail, setFilingDetail] = useState<SecFilingDetail | null>(null);
  const [irDocumentDetail, setIrDocumentDetail] = useState<IrDocumentDetail | null>(null);
  const [filingComparison, setFilingComparison] = useState<FilingComparison | null>(null);
  const [detailPersistence, setDetailPersistence] = useState<"postgres" | "memory">("memory");
  const [detailTab, setDetailTab] = useState<"evidence" | "changes">("evidence");
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [copiedPassage, setCopiedPassage] = useState<string | null>(null);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [routeCompanyId, setRouteCompanyId] = useState(initialRoute.companyId ?? "");
  const [routeEvidenceCompanyId, setRouteEvidenceCompanyId] = useState(initialRoute.evidenceCompanyId ?? "");
  const [routeMemoId, setRouteMemoId] = useState(initialRoute.memoId ?? "");
  const [routeResearchAssistantId, setRouteResearchAssistantId] = useState(initialRoute.researchAssistantId ?? "");
  const [routeResearchQualityRunId, setRouteResearchQualityRunId] = useState(initialRoute.researchQualityRunId ?? "");
  const detailRequest = useRef<AbortController | null>(null);

  const syncRoute = useCallback(() => {
    const route = parseTerminalRoute(pathname, searchParams);
    setActiveNav(route.activeNav);
    setRouteCompanyId(route.companyId ?? "");
    setRouteEvidenceCompanyId(route.evidenceCompanyId ?? "");
    setRouteMemoId(route.memoId ?? "");
    setRouteResearchAssistantId(route.researchAssistantId ?? "");
    setRouteResearchQualityRunId(route.researchQualityRunId ?? "");
    if (route.selectedTheme) {
      const routeTheme = route.selectedTheme;
      setSelectedTheme(routeTheme);
      const matchingGroup = themeGroups.find((group) => (group.items as readonly string[]).includes(routeTheme));
      if (matchingGroup) setActiveThemeGroup(matchingGroup.title);
    }
  }, [pathname, searchParams]);

  const navigate = useCallback((path: string) => {
    const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (currentPath !== path) router.push(path);
    setSidebarOpen(false);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    queueMicrotask(syncRoute);
  }, [syncRoute]);

  useEffect(() => {
    if (!["AI Infra Map", "Themes", "Alerts"].includes(activeNav)) return;
    const controller = new AbortController();

    async function refreshOnLoad() {
      try {
        const response = await fetch("/api/sec-evidence", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("SEC refresh request failed");
        }

        const result = (await response.json()) as SecEvidenceResponse;
        setLiveSecCache(result.cache);
        setSecRefreshStatus(result.refresh.status);
        setSourceStatusMessage(result.refresh.message ?? `Source catalog observed ${formatFilingDate(result.refresh.observedAt.slice(0, 10))}.`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSecRefreshStatus("stale");
        setSourceStatusMessage("Source catalog is unavailable.");
      }
    }

    void refreshOnLoad();
    return () => controller.abort();
  }, [activeNav]);

  useEffect(() => {
    if (!["AI Infra Map", "Themes"].includes(activeNav)) return;
    const controller = new AbortController();
    fetch("/api/ir-evidence", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("IR refresh request failed");
        return await response.json() as IrEvidenceResponse;
      })
      .then((result) => {
        setLiveIrCache(result.cache);
        setIrRefreshStatus(result.refresh.status);
        setIrSourceStatusMessage(result.refresh.message ?? `IR catalog observed ${formatFilingDate(result.refresh.observedAt.slice(0, 10))}.`);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setIrRefreshStatus("stale");
        setIrSourceStatusMessage("IR catalog is unavailable.");
      });
    return () => controller.abort();
  }, [activeNav]);

  useEffect(() => () => detailRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/alerts?status=unread", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result?.summary) setUnreadAlertCount(result.summary.unread);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const neocloudResearchView = useMemo(
    () => createNeocloudResearchView(liveSecCache, liveIrCache),
    [liveIrCache, liveSecCache],
  );
  const researchView = useMemo(
    () => selectedTheme === LIVE_THEME ? neocloudResearchView : createRoadmapResearchView(),
    [neocloudResearchView, selectedTheme],
  );
  const combinedSourceStatus: SecUiStatus = secRefreshStatus === "stale" || irRefreshStatus === "stale"
    ? "stale"
    : secRefreshStatus === "refreshing" || irRefreshStatus === "refreshing"
      ? "refreshing"
      : secRefreshStatus === "cached" || irRefreshStatus === "cached" ? "cached" : "fresh";
  const liveStatusLabel = combinedSourceStatus === "refreshing" ? "Loading SEC and IR catalogs" : `SEC: ${sourceStatusMessage} IR: ${irSourceStatusMessage}`;

  const selectTheme = (theme: string) => {
    setSelectedTheme(theme);
    setToast(`${theme} research view loaded`);
    window.setTimeout(() => setToast(null), 2200);
    navigate(`/themes/${slugify(theme)}`);
  };

  const closeEvidenceDetail = () => {
    detailRequest.current?.abort();
    setSelectedEvidence(null);
    setFilingDetail(null);
    setIrDocumentDetail(null);
    setFilingComparison(null);
    setDetailStatus("idle");
    setDetailError("");
  };

  const openEvidenceDetail = async (evidence: EvidenceDocument) => {
    if (!evidence.detailKind) {
      setToast("Detailed extraction is unavailable for this source");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }

    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedEvidence(evidence);
    setFilingDetail(null);
    setIrDocumentDetail(null);
    setFilingComparison(null);
    setDetailTab("evidence");
    setDetailError("");
    setDetailStatus("loading");

    if (evidence.detailKind === "ir") {
      if (!evidence.documentId) {
        setDetailError("This IR document is missing its evidence identifier.");
        setDetailStatus("error");
        return;
      }
      try {
        const response = await fetch(`/api/ir-document-detail?id=${encodeURIComponent(evidence.documentId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as IrDocumentDetailResponse | { error: string };
        if (!response.ok || !("detail" in result)) {
          throw new Error("error" in result ? result.error : "Unable to extract this IR document");
        }
        setIrDocumentDetail(result.detail);
        setDetailPersistence(result.persistence);
        setDetailStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailError(error instanceof Error ? error.message : "Unable to extract this IR document");
        setDetailStatus("error");
      }
      return;
    }

    if (!evidence.cik || !evidence.accessionNumber || !evidence.primaryDocument || !evidence.formType || !evidence.filedAt) {
      setDetailError("This SEC filing is missing extraction metadata.");
      setDetailStatus("error");
      return;
    }

    const params = new URLSearchParams({
      cik: evidence.cik,
      accession: evidence.accessionNumber,
      document: evidence.primaryDocument,
      form: evidence.formType,
      filedAt: evidence.filedAt,
    });
    const previous = findPreviousFiling(evidence, liveSecCache);
    if (previous) {
      params.set("previouscik", previous.cik);
      params.set("previousaccession", previous.accessionNumber);
      params.set("previousdocument", previous.primaryDocument);
      params.set("previousform", previous.formType);
      params.set("previousfiledAt", previous.filedAt);
    }

    try {
      const response = await fetch(`/api/sec-filing-detail?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json()) as SecFilingDetailResponse | { error: string };
      if (!response.ok || !("detail" in result)) {
        throw new Error("error" in result ? result.error : "Unable to extract this filing");
      }
      setFilingDetail(result.detail);
      setFilingComparison(result.comparison);
      setDetailPersistence(result.persistence);
      setDetailStatus("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetailError(error instanceof Error ? error.message : "Unable to extract this filing");
      setDetailStatus("error");
    }
  };

  const copyPassage = async (passageId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedPassage(passageId);
    window.setTimeout(() => setCopiedPassage(null), 1800);
  };

  const openAlertFiling = (filingId: string) => {
    const filing = liveSecCache.filings.find((candidate) => candidate.id === filingId);
    if (!filing) {
      setToast("This filing is outside the current evidence window");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    void openEvidenceDetail({
      source: `SEC ${filing.formType}`,
      company: `${filing.companyName} (${filing.ticker})`,
      claim: filing.summary,
      age: formatFilingDate(filing.filedAt),
      score: filing.sourceQuality,
      signal: filing.signal,
      sourceUrl: filing.sourceUrl,
      accessionNumber: filing.accessionNumber,
      cik: filing.cik,
      primaryDocument: filing.primaryDocument,
      formType: filing.formType,
      filedAt: filing.filedAt,
      isLive: true,
      canExtract: true,
      detailKind: "sec",
    });
  };

  const activeSection = navigationSectionFor(activeNav);
  const ActiveSectionIcon = activeSection.icon;
  const activeToolLabel = activeSection.tools.find((tool) => tool.view === activeNav)?.label ?? activeSection.description;

  return (
    <main className="terminal-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <AppLogo />
          <span>AI Infrastructure<br />Terminal</span>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navigationSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.label}
                className={`nav-item ${activeSection.label === section.label ? "active" : ""}`}
                onClick={() => navigate(section.path)}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span><strong>{section.label}</strong><small>{section.description}</small></span>
                {section.label === "Monitor" && unreadAlertCount > 0 && <b>{unreadAlertCount > 99 ? "99+" : unreadAlertCount}</b>}
              </button>
            );
          })}
        </nav>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="workspace-context"><ActiveSectionIcon size={17} /><span><small>{activeSection.label}</small><strong>{activeToolLabel}</strong></span></div>
          <div className="header-actions">
            <button className="command-button" onClick={() => navigate("/memos")}><Plus size={16} /> <span>New Memo</span></button>
            <UserMenu auth={auth} onAuthChange={onAuthChange} />
          </div>
        </header>

        {activeSection.tools.length > 0 && (
          <nav className="context-nav" aria-label={`${activeSection.label} tools`}>
            <div className="context-nav-tools">
              {activeSection.tools.map((tool) => {
                const ToolIcon = tool.icon;
                return (
                  <button key={tool.path} className={activeNav === tool.view ? "active" : ""} onClick={() => navigate(tool.path)}>
                    <ToolIcon size={14} />
                    <span>{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        <Suspense fallback={<RouteLoading label={`Opening ${activeToolLabel}`} />}>
        {activeNav === "Alerts" ? (
          <AlertsWorkspace onOpenFiling={openAlertFiling} onUnreadChange={setUnreadAlertCount} />
        ) : activeNav === "Live Events" ? (
          <EventIntelligenceWorkspace />
        ) : activeNav === "Evidence Feed" ? (
          <EvidenceWorkspace
            initialCompanyId={routeEvidenceCompanyId}
            onBuildComparison={() => navigate("/memos")}
            onCompanyChange={(companyId) => navigate(companyId ? `/evidence?company=${encodeURIComponent(companyId)}` : "/evidence")}
          />
        ) : activeNav === "Memos" ? (
          <ComparisonWorkspace
            initialMemoId={routeMemoId}
            onReviewEvidence={() => navigate("/evidence")}
            onMemoSelect={(memoId) => navigate(`/memos/${routeEntitySegment(memoId)}`)}
          />
        ) : activeNav === "Research Assistant" ? (
          <ResearchAssistantWorkspace
            key={routeResearchAssistantId || "research-assistant-index"}
            initialSessionId={routeResearchAssistantId}
            onSessionSelect={(sessionId) => navigate(`/research-assistant/${routeEntitySegment(sessionId)}`)}
            onOpenMemo={(memoId) => navigate(`/memos/${routeEntitySegment(memoId)}`)}
          />
        ) : activeNav === "Research Replay" ? (
          <ResearchReplayWorkspace />
        ) : activeNav === "Research Quality" ? (
          <ResearchQualityWorkspace
            initialRunId={routeResearchQualityRunId}
            onRunSelect={(runId) => navigate(`/research-quality/${routeEntitySegment(runId)}`)}
          />
        ) : activeNav === "Companies" ? (
          <CompanyIntelligenceWorkspace
            initialCompanyId={routeCompanyId}
            onCompanyChange={(companyId) => navigate(`/companies/${encodeURIComponent(companyId)}`)}
          />
        ) : activeNav === "Theses" ? (
          <ThesisWorkspace />
        ) : activeNav === "Activity" ? (
          <OperationsWorkspace />
        ) : activeNav === "Audit Trail" ? (
          <AuditWorkspace />
        ) : activeNav === "Lineage" ? (
          <LineageWorkspace />
        ) : activeNav === "AI Infra Map" ? (
        <NeocloudOverview
          secCount={liveSecCache.filings.length}
          irCount={liveIrCache.documents.length}
          coveredCompanyCount={neocloudResearchView.coveredCompanyCount}
          unreadAlertCount={unreadAlertCount}
          coverageCompleteness={neocloudResearchView.confidence}
          catalogSourceRating={neocloudResearchView.quality}
          recent={neocloudResearchView.recent}
          sourceStatus={{ tone: combinedSourceStatus, label: liveStatusLabel }}
          onNavigate={navigate}
        />
        ) : (
        <ThemeRoadmapWorkspace
          selectedTheme={selectedTheme}
          activeThemeGroup={activeThemeGroup}
          researchView={researchView}
          sourceStatus={{ tone: combinedSourceStatus, label: liveStatusLabel }}
          onDomainSelect={setActiveThemeGroup}
          onThemeSelect={selectTheme}
          onNavigate={navigate}
        />
        )}
        </Suspense>
      </section>

      {toast && <div className="toast"><span><ShieldCheck size={16} /></span>{toast}</div>}

      {selectedEvidence && (
        <EvidenceDetailDrawer
          evidence={selectedEvidence}
          filingDetail={filingDetail}
          irDocumentDetail={irDocumentDetail}
          comparison={filingComparison}
          persistence={detailPersistence}
          tab={detailTab}
          status={detailStatus}
          error={detailError}
          copiedPassage={copiedPassage}
          onClose={closeEvidenceDetail}
          onRetry={() => void openEvidenceDetail(selectedEvidence)}
          onTabChange={setDetailTab}
          onCopyPassage={(passageId, text) => void copyPassage(passageId, text)}
        />
      )}

    </main>
  );
}
