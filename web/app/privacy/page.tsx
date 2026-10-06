import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";

export const metadata: Metadata = {
  title: "Privacy | FAIVR",
  description: "Draft privacy notice for the FAIVR website.",
  openGraph: { title: "Privacy | FAIVR", description: "Draft website privacy notice." },
};

export default function PrivacyPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-[800px] px-4 py-14 sm:px-8">
        <p className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[.14em] text-[var(--accent)]">DRAFT, TO BE REVIEWED</p>
        <h1 className="mt-3 text-5xl font-extrabold">Privacy</h1>
        <div className="mt-8 space-y-6 leading-8 text-[var(--body)]">
          <p>The hosting provider processes server logs when you visit this website.</p>
          <p>This website uses no cookies, analytics, or third-party tracking scripts. Its fonts are served from faivr.ai.</p>
          <p>Store data handling is described on the <Link className="inline-flex min-h-11 items-center font-bold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" href="/trust">Trust page</Link>.</p>
        </div>
      </div>
    </SiteShell>
  );
}
