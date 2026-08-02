import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Infrastructure Terminal",
  description: "An evidence-grounded research workspace for AI infrastructure investing.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
