import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";
import { storedEntityId } from "@/app/terminal-navigation";

export default async function ResearchQualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/research-quality/${encodeURIComponent(id)}`;
  return <ProtectedTerminalPage route={{ activeNav: "Research Quality", researchQualityRunId: storedEntityId("research-quality", id) }} returnTo={returnTo} />;
}
