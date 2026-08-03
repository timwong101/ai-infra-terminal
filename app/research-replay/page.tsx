import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function ResearchReplayPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Research Replay" }} returnTo="/research-replay" />;
}
