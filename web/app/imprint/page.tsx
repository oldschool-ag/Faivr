import type { Metadata } from "next";
import { SiteShell } from "@/components/layout/SiteShell";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Imprint | FAIVR",
  description: "Legal notice for FAIVR, a product of Old School GmbH.",
  openGraph: { title: "Imprint | FAIVR", description: "FAIVR legal notice." },
};

export default function ImprintPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-[800px] px-4 py-14 sm:px-8">
        <h1 className="text-5xl font-extrabold">Imprint</h1>
        <address className="mt-8 not-italic leading-8 text-[var(--body)]">
          Old School GmbH<br />
          Maegeristrasse 2<br />
          6318 Walchwil<br />
          Switzerland<br />
          UID &lt;CHE-xxx.xxx.xxx&gt;<br />
          <a className="inline-flex min-h-11 items-center rounded-full bg-white px-3 py-1 font-bold text-[var(--accent)] underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </address>
      </div>
    </SiteShell>
  );
}
