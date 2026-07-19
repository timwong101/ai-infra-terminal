"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpenText,
  Building2,
  ChevronRight,
  ClipboardList,
  CircleHelp,
  Copy,
  ExternalLink,
  FileText,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertsWorkspace } from "@/app/components/alerts-workspace";
import { ComparisonWorkspace } from "@/app/components/comparison-workspace";
import { CompanyIntelligenceWorkspace } from "@/app/components/company-intelligence-workspace";
import { ResearchAssistantWorkspace } from "@/app/components/research-assistant-workspace";
import { ResearchQualityWorkspace } from "@/app/components/research-quality-workspace";
import { AuditWorkspace } from "@/app/components/audit-workspace";
import { SignInScreen, UserMenu, type AuthSession, type PublicAuthState } from "@/app/components/auth-controls";
import { EvidenceWorkspace } from "@/app/components/evidence-workspace";
import { OperationsWorkspace } from "@/app/components/operations-workspace";
import { ThesisWorkspace } from "@/app/components/thesis-workspace";
import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import type {
  EvidenceCache,
  EvidenceSignal,
  FilingComparison,
  SecEvidenceResponse,
  SecFilingDetail,
  SecFilingDetailResponse,
  SecRefreshStatus,
} from "@/lib/evidence/types";
import { baseFilingForm, getFilingComparisonMode } from "@/lib/evidence/compare";
import type { IrDocumentDetail, IrDocumentDetailResponse, IrEvidenceCache, IrEvidenceResponse, IrIngestionRun, IrIngestionSummary } from "@/lib/ir/types";

type Signal = EvidenceSignal;
type SecUiStatus = SecRefreshStatus | "refreshing";
type IrUiStatus = "fresh" | "cached" | "stale" | "refreshing";

type Evidence = {
  source: string;
  company: string;
  claim: string;
  age: string;
  score: number;
  signal: Signal;
  sourceUrl?: string;
  accessionNumber?: string;
  cik?: string;
  primaryDocument?: string;
  formType?: string;
  filedAt?: string;
  isLive?: boolean;
  canExtract?: boolean;
  detailKind?: "sec" | "ir";
  documentId?: string;
};

type ResearchView = {
  isCovered: boolean;
  recent: Array<{ title: string; source: string; age: string; sourceUrl?: string }>;
  companies: string[];
  bull: string;
  bear: string;
  confidence: number;
  quality: number;
  evidence: Evidence[];
  memoTitle: string;
  coveredCompanyCount: number;
};

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

function formatRefreshDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

const navItems = [
  { label: "AI Infra Map", icon: Network, path: "/" },
  { label: "Companies", icon: Building2, path: "/companies" },
  { label: "Themes", icon: Layers3, path: "/themes/neoclouds" },
  { label: "Evidence Feed", icon: FileText, path: "/evidence" },
  { label: "Research Assistant", icon: MessageSquareText, path: "/research-assistant" },
  { label: "Research Quality", icon: FlaskConical, path: "/research-quality" },
  { label: "Theses", icon: Target, path: "/theses" },
  { label: "Memos", icon: Sparkles, path: "/memos" },
  { label: "Alerts", icon: Bell, path: "/alerts" },
  { label: "Activity", icon: Activity, path: "/activity" },
  { label: "Audit Trail", icon: ClipboardList, path: "/audit" },
];

const LIVE_THEME = "Neoclouds";
const TRACKED_COMPANIES = [
  { id: "coreweave", name: "CoreWeave", ticker: "CRWV" },
  { id: "nebius", name: "Nebius", ticker: "NBIS" },
  { id: "applied-digital", name: "Applied Digital", ticker: "APLD" },
  { id: "iren", name: "IREN", ticker: "IREN" },
] as const;

const themeGroups = [
  { title: "Compute & Silicon", items: ["GPUs / Accelerators", "AI Servers / Racks", "Memory / HBM", "Foundry / Packaging"] },
  { title: "Cloud & Capacity", items: ["Hyperscalers", "Neoclouds", "Colocation / DC REITs", "Sovereign AI"] },
  { title: "Power & Electrical", items: ["Utilities / Generation", "Grid & Interconnect", "Power Equipment", "UPS / Batteries"] },
  { title: "Cooling & Facilities", items: ["Liquid Cooling", "Air Cooling", "Construction / EPC", "Land / Permitting"] },
  { title: "Networking", items: ["Ethernet / Switching", "InfiniBand / Fabrics", "Optical Networking", "Network Software"] },
  { title: "Physical AI", items: ["Edge Compute", "Sensors / Vision", "Robotics Platforms", "Actuators / Motion"] },
];

const themeNames = themeGroups.flatMap((group) => group.items);

function slugify(value: string) {
  return value.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type TerminalRoute = {
  activeNav: string;
  selectedTheme?: string;
  companyId?: string;
  evidenceCompanyId?: string;
  memoId?: string;
  researchAssistantId?: string;
  researchQualityRunId?: string;
};

function parseRoute(): TerminalRoute {
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const search = new URLSearchParams(window.location.search);
  if (parts[0] === "companies") return { activeNav: "Companies", companyId: parts[1] ?? "" };
  if (parts[0] === "evidence") return { activeNav: "Evidence Feed", evidenceCompanyId: search.get("company") ?? "" };
  if (parts[0] === "memos") return { activeNav: "Memos", memoId: parts[1] ?? "" };
  if (parts[0] === "research-assistant") return { activeNav: "Research Assistant", researchAssistantId: parts[1] ?? "" };
  if (parts[0] === "research-quality") return { activeNav: "Research Quality", researchQualityRunId: parts[1] ?? "" };
  if (parts[0] === "theses") return { activeNav: "Theses" };
  if (parts[0] === "alerts") return { activeNav: "Alerts" };
  if (parts[0] === "activity") return { activeNav: "Activity" };
  if (parts[0] === "audit") return { activeNav: "Audit Trail" };
  if (parts[0] === "themes") {
    return { activeNav: "Themes", selectedTheme: themeNames.find((theme) => slugify(theme) === parts[1]) ?? LIVE_THEME };
  }
  return { activeNav: "AI Infra Map", selectedTheme: LIVE_THEME };
}

function createNeocloudResearchView(cache: EvidenceCache, irCache: IrEvidenceCache): ResearchView {
  const secEvidence: Evidence[] = cache.filings.map((filing) => ({
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
  const irEvidence: Evidence[] = irCache.documents.map((document) => ({
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
    companies: TRACKED_COMPANIES.map((company) => `${company.name} (${company.ticker})`),
    bull: "AI-native clouds can win with faster accelerator access, purpose-built clusters, and software tuned for large training and inference workloads.",
    bear: "Capital intensity, customer concentration, financing costs, utilization risk, and hyperscaler competition can pressure returns on new capacity.",
    confidence: Math.round((averageQuality * 0.7) + ((coveredCompanyCount / TRACKED_COMPANIES.length) * 30)),
    quality: averageQuality,
    evidence,
    memoTitle: "Compare CoreWeave vs Nebius",
    coveredCompanyCount,
  };
}

function createRoadmapResearchView(theme: string): ResearchView {
  return {
    isCovered: false,
    recent: [],
    companies: [],
    bull: "",
    bear: "",
    confidence: 0,
    quality: 0,
    evidence: [],
    memoTitle: `${theme} research is not yet integrated`,
    coveredCompanyCount: 0,
  };
}

function findPreviousFiling(evidence: Evidence, cache: EvidenceCache) {
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

function ScoreGauge({ score, label }: { score: number; label: string }) {
  return (
    <div className="score-block">
      <p className="eyebrow">{label}</p>
      <div className="gauge" style={{ "--score": `${score * 1.8}deg` } as React.CSSProperties}>
        <div><strong>{score}</strong><span>/100</span></div>
      </div>
      <span className="score-label">{score >= 70 ? "High" : "Good"}</span>
    </div>
  );
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

export default function Home() {
  const [auth, setAuth] = useState<AuthSession | PublicAuthState | null>(null);

  const loadAuth = useCallback(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const result = await response.json() as AuthSession | PublicAuthState;
    setAuth(result);
  }, []);

  useEffect(() => { queueMicrotask(() => void loadAuth()); }, [loadAuth]);

  if (!auth) return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={25} /><strong>Opening analyst workspace</strong><span>Validating your session and active workspace.</span></div>;
  if (!auth.authenticated) return <SignInScreen state={auth} onSignedIn={loadAuth} />;
  return <Terminal auth={auth} onAuthChange={loadAuth} />;
}

function Terminal({ auth, onAuthChange }: { auth: AuthSession; onAuthChange: () => Promise<void> }) {
  const [selectedTheme, setSelectedTheme] = useState("Neoclouds");
  const [activeTab, setActiveTab] = useState("Overview");
  const [activeNav, setActiveNav] = useState("AI Infra Map");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All sources");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [liveSecCache, setLiveSecCache] = useState(secEvidenceCache);
  const [liveIrCache, setLiveIrCache] = useState(irEvidenceCache);
  const [secRefreshStatus, setSecRefreshStatus] = useState<SecUiStatus>("refreshing");
  const [irRefreshStatus, setIrRefreshStatus] = useState<IrUiStatus>("refreshing");
  const [irIngestionSummary, setIrIngestionSummary] = useState<IrIngestionSummary | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [filingDetail, setFilingDetail] = useState<SecFilingDetail | null>(null);
  const [irDocumentDetail, setIrDocumentDetail] = useState<IrDocumentDetail | null>(null);
  const [filingComparison, setFilingComparison] = useState<FilingComparison | null>(null);
  const [detailPersistence, setDetailPersistence] = useState<"postgres" | "memory">("memory");
  const [detailTab, setDetailTab] = useState<"evidence" | "changes">("evidence");
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [copiedPassage, setCopiedPassage] = useState<string | null>(null);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [routeCompanyId, setRouteCompanyId] = useState("");
  const [routeEvidenceCompanyId, setRouteEvidenceCompanyId] = useState("");
  const [routeMemoId, setRouteMemoId] = useState("");
  const [routeResearchAssistantId, setRouteResearchAssistantId] = useState("");
  const [routeResearchQualityRunId, setRouteResearchQualityRunId] = useState("");
  const detailRequest = useRef<AbortController | null>(null);

  const syncRoute = useCallback(() => {
    const route = parseRoute();
    setActiveNav(route.activeNav);
    setRouteCompanyId(route.companyId ?? "");
    setRouteEvidenceCompanyId(route.evidenceCompanyId ?? "");
    setRouteMemoId(route.memoId ?? "");
    setRouteResearchAssistantId(route.researchAssistantId ?? "");
    setRouteResearchQualityRunId(route.researchQualityRunId ?? "");
    if (route.selectedTheme) {
      setSelectedTheme(route.selectedTheme);
      setActiveTab("Overview");
      setSourceFilter("All sources");
    }
  }, []);

  const navigate = useCallback((path: string) => {
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, "", path);
    syncRoute();
    setSidebarOpen(false);
  }, [syncRoute]);

  useEffect(() => {
    queueMicrotask(syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [syncRoute]);

  useEffect(() => {
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
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSecRefreshStatus("stale");
      }
    }

    void refreshOnLoad();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ir-evidence", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("IR refresh request failed");
        return await response.json() as IrEvidenceResponse;
      })
      .then(async (result) => {
        setLiveIrCache(result.cache);
        setIrRefreshStatus(result.refresh.status);
        if (result.ingestion) setIrIngestionSummary(result.ingestion);
        try {
          const queueResponse = await fetch("/api/ir-ingestion", { method: "POST", cache: "no-store", signal: controller.signal });
          if (queueResponse.ok) {
            const queueResult = await queueResponse.json() as IrIngestionRun;
            setIrIngestionSummary(queueResult.summary);
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) return;
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setIrRefreshStatus("stale");
      });
    return () => controller.abort();
  }, []);

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
    () => selectedTheme === LIVE_THEME ? neocloudResearchView : createRoadmapResearchView(selectedTheme),
    [neocloudResearchView, selectedTheme],
  );

  const metrics = useMemo(() => [
    {
      label: "Real source documents",
      value: String(liveSecCache.filings.length + liveIrCache.documents.length),
      change: secRefreshStatus === "refreshing"
        ? "Refreshing on page load"
        : `${liveSecCache.filings.length} SEC + ${liveIrCache.documents.length} IR`,
      icon: FileText,
      tone: "positive",
    },
    {
      label: "Tracked companies",
      value: `${neocloudResearchView.coveredCompanyCount} / ${TRACKED_COMPANIES.length}`,
      change: "CoreWeave · Nebius · APLD · IREN",
      icon: Building2,
      tone: "positive",
    },
    { label: "Thesis alerts", value: String(unreadAlertCount), change: "Evidence-backed", icon: Bell, tone: "positive" },
    {
      label: "Live themes",
      value: `1 / ${themeGroups.reduce((total, group) => total + group.items.length, 0)}`,
      change: "Neoclouds integrated",
      icon: Network,
      tone: "positive",
    },
  ], [liveIrCache, liveSecCache, neocloudResearchView.coveredCompanyCount, secRefreshStatus, unreadAlertCount]);

  const ingestion = useMemo(() => [
    {
      name: "SEC Filings",
      detail: `${liveSecCache.filings.length} filings`,
      time: formatRefreshDate(liveSecCache.generatedAt),
      status: secRefreshStatus === "refreshing"
        ? "Refreshing"
        : secRefreshStatus === "fresh"
          ? "Live"
          : secRefreshStatus === "cached"
            ? "Cached"
            : "Stale cache",
      connected: secRefreshStatus === "fresh" || secRefreshStatus === "cached",
    },
    {
      name: "IR Pages",
      detail: irIngestionSummary
        ? [
            `${irIngestionSummary.completed} extracted`,
            `${irIngestionSummary.pending} queued`,
            irIngestionSummary.processing ? `${irIngestionSummary.processing} running` : null,
            irIngestionSummary.failed ? `${irIngestionSummary.failed} failed` : null,
          ].filter(Boolean).join(" · ")
        : `${liveIrCache.documents.length} documents`,
      time: formatRefreshDate(liveIrCache.generatedAt),
      status: irRefreshStatus === "refreshing" ? "Refreshing" : irRefreshStatus === "fresh" ? "Live" : irRefreshStatus === "cached" ? "Cached" : "Stale cache",
      connected: irRefreshStatus === "fresh" || irRefreshStatus === "cached",
    },
    { name: "GDELT News", detail: "Not connected", time: "Roadmap", status: "Planned", connected: false },
    { name: "EIA Power Data", detail: "Not connected", time: "Roadmap", status: "Planned", connected: false },
    { name: "Manual Notes", detail: "Not configured", time: "Roadmap", status: "Planned", connected: false },
  ], [irIngestionSummary, irRefreshStatus, liveIrCache, liveSecCache, secRefreshStatus]);

  const liveStatusLabel = secRefreshStatus === "refreshing"
    ? "Refreshing SEC"
    : secRefreshStatus === "fresh"
      ? "SEC refreshed"
      : secRefreshStatus === "cached"
        ? "SEC cache current"
        : "Using cached SEC";

  const filteredEvidence = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return researchView.evidence.filter((row) => {
      const matchesQuery = !normalized || Object.values(row).join(" ").toLowerCase().includes(normalized);
      const matchesSource = sourceFilter === "All sources" || row.source === sourceFilter;
      return matchesQuery && matchesSource;
    });
  }, [query, researchView, sourceFilter]);

  const sourceOptions = useMemo(
    () => ["All sources", ...Array.from(new Set(researchView.evidence.map((row) => row.source)))],
    [researchView],
  );
  const evidencePreview = filteredEvidence.slice(0, 8);

  const selectTheme = (theme: string) => {
    setSelectedTheme(theme);
    setActiveTab("Overview");
    setSourceFilter("All sources");
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

  const openEvidenceDetail = async (evidence: Evidence) => {
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

  const documentDetail = filingDetail ?? irDocumentDetail;
  const documentDate = filingDetail?.filedAt ?? irDocumentDetail?.publishedAt;
  const documentType = filingDetail?.formType ?? irDocumentDetail?.documentType;

  return (
    <main className="terminal-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <AppLogo />
          <span>AI Infrastructure<br />Terminal</span>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={`nav-item ${activeNav === item.label ? "active" : ""}`}
                onClick={() => { navigate(item.path); setToast(`${item.label} selected`); window.setTimeout(() => setToast(null), 1800); }}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.label === "Alerts" && unreadAlertCount > 0 && <b>{unreadAlertCount > 99 ? "99+" : unreadAlertCount}</b>}
              </button>
            );
          })}
        </nav>
        <button className="collapse-button" onClick={() => setSidebarOpen(false)}>
          <PanelLeftClose size={17} />
          <span>Collapse</span>
        </button>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <label className="global-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies, themes, claims, filings..." />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
          </label>
          <div className="header-actions">
            <button className="command-button" onClick={() => navigate("/memos")}><Plus size={16} /> <span>New Memo</span></button>
            <button className="command-button" onClick={() => navigate("/activity")}><Star size={16} /> <span>Watchlist</span></button>
            <UserMenu auth={auth} onAuthChange={onAuthChange} />
          </div>
        </header>

        {activeNav === "Alerts" ? (
          <AlertsWorkspace onOpenFiling={openAlertFiling} onUnreadChange={setUnreadAlertCount} />
        ) : activeNav === "Evidence Feed" ? (
          <EvidenceWorkspace
            initialCompanyId={routeEvidenceCompanyId}
            onBuildComparison={() => navigate("/memos")}
            onCompanyChange={(companyId) => navigate(companyId ? `/evidence?company=${encodeURIComponent(companyId)}` : "/evidence")}
          />
        ) : activeNav === "Memos" ? (
          <ComparisonWorkspace
            key={routeMemoId || "memo-index"}
            initialMemoId={routeMemoId}
            onReviewEvidence={() => navigate("/evidence")}
            onMemoSelect={(memoId) => navigate(`/memos/${encodeURIComponent(memoId)}`)}
          />
        ) : activeNav === "Research Assistant" ? (
          <ResearchAssistantWorkspace
            key={routeResearchAssistantId || "research-assistant-index"}
            initialSessionId={routeResearchAssistantId}
            onSessionSelect={(sessionId) => navigate(`/research-assistant/${encodeURIComponent(sessionId)}`)}
            onOpenMemo={(memoId) => navigate(`/memos/${encodeURIComponent(memoId)}`)}
          />
        ) : activeNav === "Research Quality" ? (
          <ResearchQualityWorkspace
            key={routeResearchQualityRunId || "research-quality-index"}
            initialRunId={routeResearchQualityRunId}
            onRunSelect={(runId) => navigate(`/research-quality/${encodeURIComponent(runId)}`)}
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
        ) : (
        <div className="dashboard">
          <div className="title-row">
            <div>
              <p className="breadcrumb">Research workspace / Infrastructure</p>
              <h1>AI Infrastructure Map</h1>
            </div>
            <div className={`live-status ${secRefreshStatus}`} data-refresh-status={secRefreshStatus}>
              <span /> {liveStatusLabel}
            </div>
          </div>

          <section className="metrics-grid" aria-label="Research metrics">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article className="metric-card" key={metric.label}>
                  <div className="metric-icon"><Icon size={23} strokeWidth={1.6} /></div>
                  <div><p>{metric.label}</p><strong>{metric.value}</strong><span className={metric.tone}>{metric.tone === "negative" ? "↓" : "↑"} {metric.change}</span></div>
                </article>
              );
            })}
          </section>

          <section className="primary-grid">
            <article className="panel themes-panel">
              <div className="panel-heading"><div><span className="section-kicker">Market structure</span><h2>Infrastructure Themes</h2></div><button className="icon-button" aria-label="Theme map help"><CircleHelp size={16} /></button></div>
              <div className="theme-map">
                <div className="map-origin"><div className="chip-icon"><Activity size={17} /></div><span>AI<br />Infrastructure</span></div>
                <div className="theme-grid">
                  {themeGroups.map((group) => (
                    <div className="theme-group" key={group.title}>
                      <h3>{group.title}</h3>
                      <div className="theme-list">
                        {group.items.map((theme) => (
                          <button
                            key={theme}
                            className={`${selectedTheme === theme ? "selected" : ""} ${theme === LIVE_THEME ? "covered" : "roadmap"}`}
                            onClick={() => selectTheme(theme)}
                          >
                            <span>{theme}</span>
                            <em>{theme === LIVE_THEME ? "Live" : "Roadmap"}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="map-legend"><span><i className="coverage-dot live" /> Live coverage</span><span><i className="coverage-dot roadmap" /> Research roadmap</span><span className="selected-label">Selected: {selectedTheme}</span></div>
            </article>

            <article className="panel research-panel">
              <div className="research-header">
                <div><span className="section-kicker">Selected theme</span><h2>{selectedTheme}</h2></div>
                <span className={`theme-badge ${researchView.isCovered ? "live" : "roadmap"}`}>{researchView.isCovered ? "Live coverage" : "Roadmap"}</span>
              </div>
              <div className="tabs" role="tablist" aria-label={`${selectedTheme} research sections`}>
                {["Overview", "Evidence", "Companies", "Memos", "Questions"].map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} disabled={!researchView.isCovered && tab !== "Overview"} onClick={() => setActiveTab(tab)}>{tab}</button>)}
              </div>
              <div className="research-content">
                {!researchView.isCovered ? (
                  <div className="tab-placeholder coverage-placeholder">
                    <span className="tab-icon"><Layers3 size={22} /></span>
                    <h3>{selectedTheme} is on the research roadmap</h3>
                    <p>No companies, evidence, scores, or generated conclusions are shown until this theme has configured official sources and passes the same provenance policy as Neoclouds.</p>
                    <button onClick={() => selectTheme(LIVE_THEME)}>Open live Neocloud coverage</button>
                  </div>
                ) : activeTab === "Overview" ? (
                  <>
                    <div className="recent-column">
                      <h3>Recent evidence</h3>
                      {researchView.recent.map((item) => item.sourceUrl ? (
                        <a className="evidence-item" href={item.sourceUrl} key={item.title} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{item.title}</strong><em>{item.source}</em></span><time>{item.age}</time><ExternalLink className="source-external" size={12} /></a>
                      ) : (
                        <button className="evidence-item" key={item.title}><FileText size={16} /><span><strong>{item.title}</strong><em>{item.source}</em></span><time>{item.age}</time></button>
                      ))}
                      <button className="text-link" onClick={() => navigate("/evidence")}>View all evidence <ChevronRight size={15} /></button>
                    </div>
                    <div className="thesis-column">
                      <h3>Key companies</h3>
                      <div className="company-tags">{TRACKED_COMPANIES.map((company) => { const label = `${company.name} (${company.ticker})`; return <button key={company.id} onClick={() => navigate(`/companies/${company.id}`)}>{label}</button>; })}</div>
                      <div className="thesis-copy"><h3>Bull thesis</h3><p>{researchView.bull}</p><h3>Bear thesis</h3><p>{researchView.bear}</p></div>
                    </div>
                    <div className="scores-column"><ScoreGauge score={researchView.confidence} label="Coverage confidence" /><ScoreGauge score={researchView.quality} label="Source quality" /><button className="text-link" onClick={() => navigate("/evidence")}>Review inputs <ChevronRight size={14} /></button></div>
                  </>
                ) : (
                  <div className="tab-placeholder">
                    <span className="tab-icon"><Layers3 size={22} /></span>
                    <h3>{activeTab} for {selectedTheme}</h3>
                    <p>Open the dedicated workspace to inspect the underlying records and complete this research workflow.</p>
                    <button onClick={() => navigate(activeTab === "Companies" ? "/companies" : activeTab === "Memos" ? "/memos" : activeTab === "Evidence" ? "/evidence" : "/theses")}>Open {activeTab.toLowerCase()} workspace</button>
                  </div>
                )}
              </div>
            </article>
          </section>

          <section className="secondary-grid">
            <article className="panel evidence-panel">
              <div className="panel-heading compact"><div className="heading-with-count"><h2>Evidence Feed</h2><span>{filteredEvidence.length}</span></div><div className="table-actions"><select aria-label="Filter evidence source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>{sourceOptions.map((source) => <option key={source}>{source}</option>)}</select><button className="text-link" onClick={() => navigate("/evidence")}>View all <ChevronRight size={14} /></button></div></div>
              <div className="evidence-table-wrap">
                <table className="evidence-table">
                  <colgroup>
                    <col className="source-column" />
                    <col className="company-column" />
                    <col className="claim-column" />
                    <col className="recency-column" />
                    <col className="score-column" />
                  </colgroup>
                  <thead><tr><th>Source</th><th>Company</th><th>Claim impacted</th><th>Recency</th><th>Evidence score</th></tr></thead>
                  <tbody>
                    {evidencePreview.map((row, index) => (
                      <tr
                        key={row.accessionNumber ?? `${row.company}-${index}`}
                        className={row.canExtract ? "evidence-row actionable" : "evidence-row"}
                        tabIndex={row.canExtract ? 0 : undefined}
                        onClick={row.canExtract ? () => void openEvidenceDetail(row) : undefined}
                        onKeyDown={(event) => {
                          if (row.canExtract && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            void openEvidenceDetail(row);
                          }
                        }}
                      >
                        <td>
                          <div className="source-cell">
                            {row.sourceUrl ? (
                              <a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer" title={`Open ${row.source} source`} onClick={(event) => event.stopPropagation()}>
                                <FileText size={14} />
                                <span className="source-name">{row.source}</span>
                                {row.isLive && <span className="live-source">Real</span>}
                                <ExternalLink size={11} />
                              </a>
                            ) : <><FileText size={14} /><span className="source-name">{row.source}</span></>}
                          </div>
                        </td>
                        <td title={row.company}>{row.company}</td>
                        <td title={row.claim}>{row.claim}</td>
                        <td>{row.age}</td>
                        <td><div className="evidence-score"><strong>{row.score}</strong><span className="score-bar"><i className={row.signal} style={{ width: `${row.score}%` }} /></span></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!evidencePreview.length && <div className="empty-state"><Search size={19} /><span>{researchView.isCovered ? "No evidence matches this search." : `${selectedTheme} evidence is not yet integrated.`}</span>{researchView.isCovered ? <button onClick={() => { setQuery(""); setSourceFilter("All sources"); }}>Clear filters</button> : <button onClick={() => selectTheme(LIVE_THEME)}>View Neocloud evidence</button>}</div>}
              </div>
              <button className="footer-link" onClick={() => navigate("/evidence")}>View all evidence feed <ChevronRight size={15} /></button>
            </article>

            <article className="panel memo-panel">
              <div className="panel-heading compact"><div className="heading-with-count"><h2>Memo Workspace</h2><span>{researchView.isCovered ? "Grounded" : "Unavailable"}</span></div><button className="command-button small" disabled={!researchView.isCovered} onClick={() => navigate("/memos")}>Open in editor <ChevronRight size={14} /></button></div>
              {researchView.isCovered ? <>
                <div className="memo-title"><div><h3>{researchView.memoTitle}</h3><p>Built from accepted evidence in the research catalog</p></div><div><span>{researchView.coveredCompanyCount} companies</span><span>{researchView.evidence.length} source documents</span></div></div>
                <div className="memo-readiness">
                  <div className="memo-readiness-score"><Sparkles size={19} /><span><strong>{researchView.confidence}</strong><small>coverage confidence</small></span></div>
                  <div><strong>Claim-to-evidence comparisons</strong><p>The memo builder retrieves accepted SEC and IR passages, verifies every citation, and preserves the exact source packet.</p></div>
                  <button className="primary-button" onClick={() => navigate("/memos")}><Plus size={15} /> Build comparison</button>
                </div>
              </> : <div className="workspace-state memo-roadmap-state"><CircleHelp size={24} /><strong>No supported memo universe</strong><span>Memo creation is available only for themes with configured companies and reviewed evidence.</span><button className="command-button" onClick={() => selectTheme(LIVE_THEME)}>Return to Neoclouds</button></div>}
            </article>
          </section>
        </div>
        )}

        <footer className="ingestion-bar">
          <div className="ingestion-title"><strong>Ingestion Status</strong><CircleHelp size={14} /></div>
          {ingestion.map((item) => <div className="ingestion-item" key={item.name}><div><strong>{item.name}</strong><span>Last run: {item.time}</span><span>{item.detail}</span></div><span className={item.connected ? "success-dot" : "success-dot status-pending"}>{item.connected ? <ShieldCheck size={15} /> : <CircleHelp size={15} />}{item.status}</span></div>)}
          <button onClick={() => navigate("/activity")}>View Ingestion Dashboard <ChevronRight size={15} /></button>
        </footer>
      </section>

      {toast && <div className="toast"><span><ShieldCheck size={16} /></span>{toast}</div>}

      {selectedEvidence && (
        <div className="evidence-drawer-layer" role="presentation" onMouseDown={closeEvidenceDetail}>
          <aside
            className="evidence-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <div>
                <span className="section-kicker">Source document</span>
                <h2 id="evidence-detail-title">{selectedEvidence.company}</h2>
                <p>{selectedEvidence.source} · {selectedEvidence.age}</p>
              </div>
              <button className="icon-button drawer-close" onClick={closeEvidenceDetail} aria-label="Close evidence detail" title="Close evidence detail"><X size={18} /></button>
            </header>

            {detailStatus === "loading" && (
              <div className="drawer-state">
                <LoaderCircle className="drawer-spinner" size={25} />
                <strong>Extracting source evidence</strong>
                <p>Reading the source document and identifying citation-ready research passages.</p>
              </div>
            )}

            {detailStatus === "error" && (
              <div className="drawer-state error">
                <AlertTriangle size={24} />
                <strong>Extraction unavailable</strong>
                <p>{detailError}</p>
                <button className="command-button" onClick={() => void openEvidenceDetail(selectedEvidence)}>Try again</button>
              </div>
            )}

            {detailStatus === "ready" && documentDetail && documentDate && documentType && (
              <div className="drawer-body">
                <section className="filing-summary">
                  <div><span>{irDocumentDetail ? "Published" : "Filed"}</span><strong>{formatFilingDate(documentDate)}</strong></div>
                  <div><span>{irDocumentDetail ? "Document" : "Form"}</span><strong>{documentType}</strong></div>
                  <div><span>{irDocumentDetail?.pageCount ? "Pages / words" : "Words scanned"}</span><strong>{irDocumentDetail?.pageCount ? `${irDocumentDetail.pageCount} / ${documentDetail.wordCount.toLocaleString()}` : documentDetail.wordCount.toLocaleString()}</strong></div>
                  <div><span>Extraction</span><strong className={`quality-${documentDetail.extraction.quality}`}>{documentDetail.extraction.quality}</strong></div>
                </section>

                <div className="extraction-note"><ShieldCheck size={15} /><span>{documentDetail.extraction.message} {detailPersistence === "postgres" ? "Saved to Postgres." : "Using the session cache."}</span></div>

                {filingDetail && <div className="drawer-tabs" role="tablist" aria-label="Filing detail views">
                  <button role="tab" aria-selected={detailTab === "evidence"} className={detailTab === "evidence" ? "active" : ""} onClick={() => setDetailTab("evidence")}>
                    Evidence <span>{filingDetail.sections.reduce((total, section) => total + section.passages.length, 0)}</span>
                  </button>
                  <button role="tab" aria-selected={detailTab === "changes"} className={detailTab === "changes" ? "active" : ""} onClick={() => setDetailTab("changes")}>
                    {getFilingComparisonMode(filingDetail.formType) === "event"
                      ? "Event signals"
                      : getFilingComparisonMode(filingDetail.formType) === "amendment"
                        ? "Changes from base filing"
                        : "Changes since prior period"} <span>{filingComparison ? Object.values(filingComparison.counts).reduce((total, count) => total + count, 0) : 0}</span>
                  </button>
                </div>}

                {(irDocumentDetail || detailTab === "evidence") && documentDetail.sections.length > 0 ? (
                  <div className="filing-sections">
                    {documentDetail.sections.map((section) => (
                      <section className="filing-section" key={section.id}>
                        <div className="filing-section-heading"><span>{section.category}</span><h3>{section.title}</h3></div>
                        {section.passages.map((passage) => (
                          <article className="evidence-passage" key={passage.id}>
                            <BookOpenText size={16} />
                            <p>{passage.text}</p>
                            <div>
                              <span className="passage-meta">
                                {passage.pageNumber && <a href={`${selectedEvidence.sourceUrl}#page=${passage.pageNumber}`} target="_blank" rel="noreferrer">Page {passage.pageNumber} <ExternalLink size={10} /></a>}
                                <span>{passage.wordCount} words</span>
                              </span>
                              <button className="icon-button" onClick={() => void copyPassage(passage.id, passage.text)} aria-label="Copy evidence passage" title="Copy evidence passage">
                                {copiedPassage === passage.id ? <ShieldCheck size={15} /> : <Copy size={15} />}
                              </button>
                            </div>
                          </article>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : irDocumentDetail || detailTab === "evidence" ? (
                  <div className="drawer-state compact"><CircleHelp size={22} /><strong>No narrative sections found</strong><p>This document may primarily contain exhibits or structured tables.</p></div>
                ) : filingComparison ? (
                  <div className="filing-changes">
                    <div className="comparison-summary">
                      <div>
                        <span>{filingComparison.previousFiling ? "Compared with" : "Comparison policy"}</span>
                        <strong>{filingComparison.previousFiling
                          ? `${filingComparison.previousFiling.formType} · ${formatFilingDate(filingComparison.previousFiling.filedAt)}`
                          : filingComparison.policyLabel}</strong>
                      </div>
                      <div className="change-counts">
                        {filingComparison.mode === "event" ? (
                          <span className="new-event">{filingComparison.counts.new_event} new event</span>
                        ) : (
                          <>
                            <span className="added">+{filingComparison.counts.added} added</span>
                            <span className="modified">{filingComparison.counts.modified} changed</span>
                            <span className="not-repeated">{filingComparison.counts.not_repeated} not repeated</span>
                            {filingComparison.counts.explicitly_removed > 0 && <span className="explicitly-removed">{filingComparison.counts.explicitly_removed} explicit removal</span>}
                          </>
                        )}
                      </div>
                      {filingComparison.previousFiling
                        ? <a href={filingComparison.previousFiling.sourceUrl} target="_blank" rel="noreferrer" title="Open prior filing"><ExternalLink size={14} /></a>
                        : <span aria-hidden="true" />}
                    </div>
                    {filingComparison.changes.length > 0 ? filingComparison.changes.map((change) => (
                      <article className="filing-change" key={change.id}>
                        <div className="change-heading">
                          <span className={`change-type ${change.type}`}>{change.type.replaceAll("_", " ")}</span>
                          <span className={`change-significance ${change.significance}`}>{change.significance}</span>
                          {change.relevanceScore !== null && <span className="change-relevance">R {change.relevanceScore}</span>}
                          {change.similarity !== null && <span className="change-similarity">{change.similarity}% overlap</span>}
                        </div>
                        <span className="change-category">{change.category}{change.eventCode ? ` · Item ${change.eventCode}` : ""}</span>
                        <h3>{change.eventType ?? change.sectionTitle}</h3>
                        <p>{change.relevanceReason ?? change.summary}</p>
                        <details>
                          <summary>Review source excerpts</summary>
                          {change.currentText && <div><strong>Current filing</strong><p>{change.currentText}</p></div>}
                          {change.previousText && <div><strong>Prior filing</strong><p>{change.previousText}</p></div>}
                        </details>
                      </article>
                    )) : <div className="drawer-state compact"><ShieldCheck size={22} /><strong>No material language changes</strong><p>The extracted passages closely match the prior filing.</p></div>}
                  </div>
                ) : (
                  <div className="drawer-state compact"><CircleHelp size={22} /><strong>No comparable prior filing</strong><p>Recurring-section comparison begins after an earlier base filing is available.</p></div>
                )}
              </div>
            )}

            <footer className="drawer-footer">
              <span>{selectedEvidence.documentId ?? selectedEvidence.accessionNumber}</span>
              <a href={irDocumentDetail?.extraction.quality === "limited" && irDocumentDetail.sections.length === 0 ? irDocumentDetail.sourcePageUrl : irDocumentDetail?.sourceUrl ?? selectedEvidence.sourceUrl} target="_blank" rel="noreferrer">Open official source <ExternalLink size={14} /></a>
            </footer>
          </aside>
        </div>
      )}

    </main>
  );
}
