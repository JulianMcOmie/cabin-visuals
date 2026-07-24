import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { AnalyticsGate } from "../src/analytics/AnalyticsGate";
import { AnalyticsIdentify } from "../src/analytics/AnalyticsIdentify";
import "./globals.css";

// Console design system: IBM Plex Sans for UI, IBM Plex Mono for numerics,
// readouts, and section labels. Both exposed as CSS variables so utilities
// (font-mono via --font-mono) and plain CSS can reach them.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Cabin Visuals",
  description: "The visual music workstation",
};

// Explicit (Next injects an equivalent default, but the mobile layouts depend
// on it): device width, no zoomed-out desktop rendering, console-dark chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c0d12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexSans.className}`}>
      <body>
        {children}
        <AnalyticsGate />
        <AnalyticsIdentify />
      </body>
    </html>
  );
}
