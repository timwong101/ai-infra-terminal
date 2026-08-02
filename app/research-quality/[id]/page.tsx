import { TerminalApplication } from "@/app/components/terminal-application";
import { storedEntityId } from "@/app/terminal-navigation";

export default async function ResearchQualityRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TerminalApplication route={{ activeNav: "Research Quality", researchQualityRunId: storedEntityId("research-quality", id) }} />;
}
