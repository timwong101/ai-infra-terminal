import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function MemosPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Memos" }} returnTo="/memos" />;
}
