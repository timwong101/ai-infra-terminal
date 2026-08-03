import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function ThesesPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Theses" }} returnTo="/theses" />;
}
