import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function AuditPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Audit Trail" }} returnTo="/audit" />;
}
