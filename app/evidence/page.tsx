import { TerminalApplication } from "@/app/components/terminal-application";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company = "" } = await searchParams;
  return <TerminalApplication route={{ activeNav: "Evidence Feed", evidenceCompanyId: company }} />;
}
