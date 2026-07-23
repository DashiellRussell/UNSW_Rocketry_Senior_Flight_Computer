import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Backdrop } from "@/components/Backdrop";
import { TopNav } from "@/components/TopNav";
import { FcdConnectionProvider } from "@/hooks/FcdConnectionProvider";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

// Serious, technical instrument-panel type — no decorative/display faces.
// IBM Plex Sans for labels/UI, IBM Plex Mono (tabular-nums) for everything
// data: numbers, telemetry, the log pane, params.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OZONE Ground Station",
  description: "Browser ground station for any fcd/1 flight computer — USB, WiFi, or built-in simulator.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Backdrop />
        <div className="grid-veil" aria-hidden="true" />
        <div className="noise-veil" aria-hidden="true" />
        <FcdConnectionProvider>
          <ToastProvider>
            <TopNav />
            {children}
          </ToastProvider>
        </FcdConnectionProvider>
      </body>
    </html>
  );
}
