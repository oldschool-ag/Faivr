import type { Metadata } from "next";
import { OldSchoolRegistrationFlow } from "@/components/operator/OldSchoolRegistrationFlow";
import { SiteShell } from "@/components/layout/SiteShell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function OldSchoolRegistrationPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <div className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Internal operator surface</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">
            Register the trusted Old School agents from the browser wallet.
          </h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            This operator flow mints the trusted four directly from the controlled owner wallet on Base mainnet, without
            using registrar privileges or off-platform private key handling.
          </p>
        </div>

        <div className="pt-10">
          <OldSchoolRegistrationFlow />
        </div>
      </div>
    </SiteShell>
  );
}
