import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";
import { storedEntityId } from "@/app/terminal-navigation";

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/memos/${encodeURIComponent(id)}`;
  return <ProtectedTerminalPage route={{ activeNav: "Memos", memoId: storedEntityId("memo", id) }} returnTo={returnTo} />;
}
