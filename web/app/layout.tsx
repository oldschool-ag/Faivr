import "./globals.css";
import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});
const mono = JetBrains_Mono({ subsets:["latin"], variable:"--font-mono" });

export const metadata: Metadata = {
  title: "FAIVR — The store for Truchsess",
  description:
    "Governed AI workers for your company.",
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
    title: "FAIVR — The store for Truchsess",
    description:
      "Governed AI workers for your company. Browse the catalog and subscribe on your Truchsess appliance.",
    siteName: "FAIVR",
    type: "website",
    url: "https://faivr.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAIVR — The store for Truchsess",
    description:
      "Governed AI workers for your company. Browse the catalog and subscribe on your Truchsess appliance.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
