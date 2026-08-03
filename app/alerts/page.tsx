import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function AlertsPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Alerts" }} returnTo="/alerts" />;
}
