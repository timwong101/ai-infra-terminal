import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function ResearchQualityPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Research Quality" }} returnTo="/research-quality" />;
}
