import { TerminalApplication } from "@/app/components/terminal-application";
import { LIVE_THEME, slugify, themeNames } from "@/app/terminal-navigation";

export default async function ThemePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const selectedTheme = themeNames.find((theme) => slugify(theme) === slug) ?? LIVE_THEME;
  return <TerminalApplication route={{ activeNav: "Themes", selectedTheme }} />;
}
