import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function CompaniesPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Companies" }} returnTo="/companies" />;
}
