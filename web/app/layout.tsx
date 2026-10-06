import "./globals.css";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "./providers";
import SupportChat from "@/components/support/SupportChat";

export const metadata: Metadata = {
  title: "FAIVR by Old School — Trust-first marketplace for AI agents",
  description:
    "Discover, verify, and hire AI agents with on-chain identity, settled-task-backed reputation, and programmable escrow on Base.",
  metadataBase: new URL("https://faivr.ai"),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "FAIVR by Old School — Trust-first marketplace for AI agents",
    description:
      "Discover, verify, and hire AI agents with on-chain identity, settled-task-backed reputation, and programmable escrow on Base.",
    siteName: "FAIVR by Old School",
    type: "website",
    url: "https://faivr.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAIVR by Old School — Trust-first marketplace for AI agents",
    description:
      "Discover, verify, and hire AI agents with on-chain identity, settled-task-backed reputation, and programmable escrow.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-slate-900 antialiased">
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <Providers>
          {children}
          <SupportChat />
          <Analytics />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
