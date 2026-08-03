import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function LineagePage() {
  return <ProtectedTerminalPage route={{ activeNav: "Lineage" }} returnTo="/lineage" />;
}
