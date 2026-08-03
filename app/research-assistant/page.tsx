import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function ResearchAssistantPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Research Assistant" }} returnTo="/research-assistant" />;
}
