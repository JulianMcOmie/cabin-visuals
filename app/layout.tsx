import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk, IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { AnalyticsGate } from "../src/analytics/AnalyticsGate";
import { AnalyticsIdentify } from "../src/analytics/AnalyticsIdentify";
import { NavigationOverlay } from "../src/components/instantNavigation";
import "./globals.css";

// "DAW Console 1a" type stack: Hanken Grotesk for UI sans, IBM Plex Mono for
// numerics/readouts/section labels, Instrument Serif (400 + italic) for
// display type - wordmarks, project titles, panel headings. All exposed as
// CSS variables so utilities (font-sans via --font-ui-sans, font-mono via
// --font-plex-mono) and plain CSS ([font-family:var(--font-display)]) can
// reach them.
const uiSans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-ui-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});
const displaySerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
});
// Console spec one-offs: Archivo 700 for the project name, IBM Plex Sans 600
// for the Export button, JetBrains Mono for the BPM value.
const archivo = Archivo({ subsets: ["latin"], weight: "700", variable: "--font-archivo" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: "600", variable: "--font-plex-sans" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

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
    <html
      lang="en"
      className={`${uiSans.variable} ${plexMono.variable} ${displaySerif.variable} ${archivo.variable} ${plexSans.variable} ${jetbrains.variable} ${uiSans.className}`}
    >
      <body>
        {children}
        <AnalyticsGate />
        <AnalyticsIdentify />
        {/* The instant loading screen every internal navigation paints first. */}
        <NavigationOverlay />
      </body>
    </html>
  );
}
