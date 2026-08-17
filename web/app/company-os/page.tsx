"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, FileKey2, PackageCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { SiteShell } from "@/components/layout/SiteShell";
import { buttonVariants } from "@/components/ui/Button";

const LIFECYCLE = [
  {
    title: "Inspect the signed catalog",
    copy: "A configured Company OS instance requests tenant-bound model and version metadata before any checkout or installation.",
    icon: FileKey2,
  },
  {
    title: "Confirm entitlement",
    copy: "FAIVR creates the checkout session. Package metadata and checksums remain unavailable until entitlement is confirmed.",
    icon: PackageCheck,
  },
  {
    title: "Install and acknowledge",
    copy: "Company OS verifies the package, activates it locally, and returns a signed receipt so installation state stays inspectable.",
    icon: CheckCircle2,
  },
  {
    title: "Update or remove with proof",
    copy: "Updates preserve compatibility checks. Uninstall and billing stop only after the required scoped receipts are verified.",
    icon: RefreshCw,
  },
] as const;

export default function CompanyOsMarketplacePage() {
  return (
    <SiteShell>
      <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        <section className="grid gap-10 border-b border-slate-200 pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
              Install governed agent packages from FAIVR.
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
              Company OS can inspect versioned manifests, obtain entitled packages, and return signed lifecycle evidence without treating public marketplace copy as package truth.
            </p>
          </div>
          <aside className="border-l-2 border-amber-500 pl-5" aria-label="Availability status">
            <p className="font-semibold text-slate-950">Integration status</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The V1 lifecycle is verified locally and in staging. Production credentials, package publication, billing, and activation are not enabled by this page.
            </p>
          </aside>
        </section>

        <section className="grid gap-10 py-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Operator path</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Start from a configured Company OS tenant. FAIVR exposes the authenticated lifecycle; Company OS remains responsible for local verification and activation.
            </p>
            <Link href="/docs" className={`${buttonVariants({ variant: "primary", size: "md" })} mt-6`}>
              Review integration requirements
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <ol className="border-t border-slate-200">
            {LIFECYCLE.map(({ title, copy, icon: Icon }, index) => (
              <li key={title} className="grid gap-4 border-b border-slate-200 py-6 sm:grid-cols-[2.5rem_2.5rem_minmax(0,1fr)] sm:items-start">
                <span className="font-mono text-sm text-slate-500" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <Icon className="h-5 w-5 text-slate-700" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-slate-950">{title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-slate-200 pt-10">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <ShieldCheck className="h-5 w-5 text-slate-700" aria-hidden="true" />
              <h2 className="mt-4 font-semibold text-slate-950">Tenant-bound requests</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Signed requests bind tenant, instance, path, body digest, nonce, timestamp, and idempotency state.</p>
            </div>
            <div>
              <PackageCheck className="h-5 w-5 text-slate-700" aria-hidden="true" />
              <h2 className="mt-4 font-semibold text-slate-950">Payload verification</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Package origin, manifest, size, file hashes, and immutable version identity are checked before activation.</p>
            </div>
            <div>
              <CheckCircle2 className="h-5 w-5 text-slate-700" aria-hidden="true" />
              <h2 className="mt-4 font-semibold text-slate-950">Evidence before state changes</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Archive, uninstall, deletion, and billing acknowledgement remain distinct, signed lifecycle events.</p>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
