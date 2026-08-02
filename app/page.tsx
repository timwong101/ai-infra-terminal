import { TerminalApplication } from "@/app/components/terminal-application";

export default function RootPage() {
  return <TerminalApplication route={{ activeNav: "AI Infra Map", selectedTheme: "Neoclouds" }} />;
}
