import {
  Activity,
  Bell,
  BookOpenText,
  Bot,
  Building2,
  ClipboardList,
  Cloud,
  Cpu,
  Fan,
  FileText,
  FlaskConical,
  GitBranch,
  History,
  MessageSquareText,
  Network,
  Newspaper,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";

export const navigationSections = [
  {
    label: "Overview",
    description: "Market map",
    icon: Network,
    path: "/home",
    views: ["AI Infra Map", "Themes"],
    tools: [],
  },
  {
    label: "Monitor",
    description: "Signals and alerts",
    icon: Bell,
    path: "/alerts",
    views: ["Alerts", "Live Events"],
    tools: [
      { label: "Alerts", icon: Bell, path: "/alerts", view: "Alerts" },
      { label: "Events", icon: Newspaper, path: "/events", view: "Live Events" },
    ],
  },
  {
    label: "Research",
    description: "Evidence and claims",
    icon: BookOpenText,
    path: "/companies",
    views: ["Companies", "Evidence Feed", "Theses", "Lineage"],
    tools: [
      { label: "Companies", icon: Building2, path: "/companies", view: "Companies" },
      { label: "Evidence", icon: FileText, path: "/evidence", view: "Evidence Feed" },
      { label: "Theses", icon: Target, path: "/theses", view: "Theses" },
      { label: "Lineage", icon: GitBranch, path: "/lineage", view: "Lineage" },
    ],
  },
  {
    label: "Analysis",
    description: "Ask and publish",
    icon: Sparkles,
    path: "/research-assistant",
    views: ["Research Assistant", "Memos", "Research Replay"],
    tools: [
      { label: "Ask", icon: MessageSquareText, path: "/research-assistant", view: "Research Assistant" },
      { label: "Memos", icon: Sparkles, path: "/memos", view: "Memos" },
      { label: "Replay", icon: History, path: "/research-replay", view: "Research Replay" },
    ],
  },
  {
    label: "System",
    description: "Pipeline and controls",
    icon: Activity,
    path: "/activity",
    views: ["Activity", "Research Quality", "Audit Trail"],
    tools: [
      { label: "Activity", icon: Activity, path: "/activity", view: "Activity" },
      { label: "Quality", icon: FlaskConical, path: "/research-quality", view: "Research Quality" },
      { label: "Audit", icon: ClipboardList, path: "/audit", view: "Audit Trail" },
    ],
  },
] as const;

export function navigationSectionFor(view: string) {
  return navigationSections.find((section) => (section.views as readonly string[]).includes(view)) ?? navigationSections[0];
}

export const LIVE_THEME = "Neoclouds";

export const TRACKED_COMPANIES = [
  { id: "coreweave", name: "CoreWeave", ticker: "CRWV" },
  { id: "nebius", name: "Nebius", ticker: "NBIS" },
  { id: "applied-digital", name: "Applied Digital", ticker: "APLD" },
  { id: "iren", name: "IREN", ticker: "IREN" },
] as const;

export const themeGroups = [
  { title: "Compute & Silicon", icon: Cpu, items: ["GPUs / Accelerators", "AI Servers / Racks", "Memory / HBM", "Foundry / Packaging"] },
  { title: "Cloud & Capacity", icon: Cloud, items: ["Hyperscalers", "Neoclouds", "Colocation / DC REITs", "Sovereign AI"] },
  { title: "Power & Electrical", icon: Zap, items: ["Utilities / Generation", "Grid & Interconnect", "Power Equipment", "UPS / Batteries"] },
  { title: "Cooling & Facilities", icon: Fan, items: ["Liquid Cooling", "Air Cooling", "Construction / EPC", "Land / Permitting"] },
  { title: "Networking", icon: Network, items: ["Ethernet / Switching", "InfiniBand / Fabrics", "Optical Networking", "Network Software"] },
  { title: "Physical AI", icon: Bot, items: ["Edge Compute", "Sensors / Vision", "Robotics Platforms", "Actuators / Motion"] },
] as const;

export const themeNames = themeGroups.flatMap((group) => group.items);

export function slugify(value: string) {
  return value.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type TerminalRoute = {
  activeNav: string;
  selectedTheme?: string;
  companyId?: string;
  evidenceCompanyId?: string;
  memoId?: string;
  researchAssistantId?: string;
  researchQualityRunId?: string;
};

export function parseTerminalRoute(): TerminalRoute {
  const parts = window.location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const search = new URLSearchParams(window.location.search);
  if (parts[0] === "companies") return { activeNav: "Companies", companyId: parts[1] ?? "" };
  if (parts[0] === "evidence") return { activeNav: "Evidence Feed", evidenceCompanyId: search.get("company") ?? "" };
  if (parts[0] === "events") return { activeNav: "Live Events" };
  if (parts[0] === "memos") return { activeNav: "Memos", memoId: parts[1] ?? "" };
  if (parts[0] === "research-assistant") return { activeNav: "Research Assistant", researchAssistantId: parts[1] ?? "" };
  if (parts[0] === "research-replay") return { activeNav: "Research Replay" };
  if (parts[0] === "research-quality") return { activeNav: "Research Quality", researchQualityRunId: parts[1] ?? "" };
  if (parts[0] === "theses") return { activeNav: "Theses" };
  if (parts[0] === "alerts") return { activeNav: "Alerts" };
  if (parts[0] === "activity") return { activeNav: "Activity" };
  if (parts[0] === "lineage") return { activeNav: "Lineage" };
  if (parts[0] === "audit") return { activeNav: "Audit Trail" };
  if (parts[0] === "themes") {
    return { activeNav: "Themes", selectedTheme: themeNames.find((theme) => slugify(theme) === parts[1]) ?? LIVE_THEME };
  }
  return { activeNav: "AI Infra Map", selectedTheme: LIVE_THEME };
}

function safeClientReturnPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/home";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/home";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/home";
  }
}

export function resolveAuthPath(authenticated: boolean) {
  const current = `${window.location.pathname}${window.location.search}`;
  if (authenticated) {
    if (window.location.pathname === "/login") return safeClientReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
    return window.location.pathname === "/" ? "/home" : current;
  }
  if (window.location.pathname === "/login") return current;
  if (window.location.pathname === "/") return "/login";
  return `/login?returnTo=${encodeURIComponent(current)}`;
}
