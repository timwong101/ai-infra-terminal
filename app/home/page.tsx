import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function HomePage() {
  return <ProtectedTerminalPage route={{ activeNav: "AI Infra Map", selectedTheme: "Neoclouds" }} returnTo="/home" />;
}
