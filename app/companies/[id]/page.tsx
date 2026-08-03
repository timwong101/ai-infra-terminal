import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/companies/${encodeURIComponent(id)}`;
  return <ProtectedTerminalPage route={{ activeNav: "Companies", companyId: id }} returnTo={returnTo} />;
}
