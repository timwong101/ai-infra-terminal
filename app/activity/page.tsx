import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function ActivityPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Activity" }} returnTo="/activity" />;
}
