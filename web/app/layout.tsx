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
    icon: [{ url: "/brand/faivr-logo.svg", type: "image/svg+xml" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "FAIVR — The store for Truchsess",
    description:
      "Governed AI workers for your company. Browse the catalog and subscribe on your Truchsess appliance.",
    siteName: "FAIVR",
    type: "website",
    url: "https://faivr.ai",
    locale: "en_US",
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
