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
          [STREET AND NUMBER]<br />
          [POSTCODE] [TOWN]<br />
          Switzerland<br />
          [UID CHE-…]<br />
          <a className="inline-flex rounded-full bg-white px-3 py-1 font-bold text-[var(--accent)] underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </address>
      </div>
    </SiteShell>
  );
}
