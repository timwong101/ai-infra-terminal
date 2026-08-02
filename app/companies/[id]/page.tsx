import { TerminalApplication } from "@/app/components/terminal-application";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TerminalApplication route={{ activeNav: "Companies", companyId: decodeURIComponent(id) }} />;
}
