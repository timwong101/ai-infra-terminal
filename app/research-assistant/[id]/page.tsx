import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";
import { storedEntityId } from "@/app/terminal-navigation";

export default async function ResearchAssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/research-assistant/${encodeURIComponent(id)}`;
  return <ProtectedTerminalPage route={{ activeNav: "Research Assistant", researchAssistantId: storedEntityId("research-assistant", id) }} returnTo={returnTo} />;
}
