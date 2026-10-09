import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";

export const metadata: Metadata = {
  title: "Privacy | FAIVR",
  description: "Privacy notice for the FAIVR website.",
  openGraph: { title: "Privacy | FAIVR", description: "FAIVR website privacy notice." },
};

export default function PrivacyPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-[800px] px-4 py-14 sm:px-8">
        <h1 className="text-5xl font-extrabold">Privacy</h1>
        <div className="mt-8 space-y-6 leading-8 text-[var(--body)]">
          <p>Responsible: Old School GmbH, Maegeristrasse 2, 6318 Walchwil, Switzerland, info@oldschool.ag.</p>
          <p>When you visit faivr.ai, our hosting provider Vercel Inc. (USA) processes technical server logs (for example IP address, time and page) to deliver and protect the site.</p>
          <p>This website sets no cookies and uses no analytics or tracking. Fonts are served from faivr.ai.</p>
          <p>If your company uses a Truchsess appliance, the store processes the data needed for packages and subscriptions, and Polar processes payments as merchant of record; details are on the <Link className="inline-flex min-h-11 items-center font-bold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" href="/trust">Trust page</Link>.</p>
          <p>You can ask what data we hold about you and ask us to correct or delete it at info@oldschool.ag.</p>
        </div>
      </div>
    </SiteShell>
  );
}
