import { ProtectedTerminalPage } from "@/app/components/protected-terminal-page";

export default async function EventsPage() {
  return <ProtectedTerminalPage route={{ activeNav: "Live Events" }} returnTo="/events" />;
}
