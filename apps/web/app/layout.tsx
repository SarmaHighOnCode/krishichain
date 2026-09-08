import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// Design language per DESIGN.md (S2-01): CohereText/Unica77 are proprietary, so we use their
// documented fallbacks — Space Grotesk for display, Inter for body/UI. CohereMono's own
// fallback (Arial) reads as an extraction artifact for something DESIGN.md calls "technical
// labels"; IBM Plex Mono is used instead so mono labels actually look monospaced.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KrishiChain",
  description: "Trust you can verify — from the farm gate to your fork.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
