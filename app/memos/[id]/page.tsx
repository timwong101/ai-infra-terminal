import { TerminalApplication } from "@/app/components/terminal-application";
import { storedEntityId } from "@/app/terminal-navigation";

export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TerminalApplication route={{ activeNav: "Memos", memoId: storedEntityId("memo", id) }} />;
}
