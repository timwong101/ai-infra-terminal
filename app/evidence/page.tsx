import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company = "" } = await searchParams;
  const returnTo = company ? `/evidence?company=${encodeURIComponent(company)}` : "/evidence";
  return <ProtectedTerminalPage route={{ activeNav: "Evidence Feed", evidenceCompanyId: company }} returnTo={returnTo} />;
}
