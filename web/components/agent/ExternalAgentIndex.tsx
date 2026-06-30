import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Fingerprint, ShieldCheck } from "lucide-react";
import {
  EXTERNAL_INDEX_DISCLOSURE,
  EXTERNAL_INDEXED_AGENTS,
  EXTERNAL_TRUST_STATUS_COPY,
  type ExternalAgentTrustStatus,
} from "@/lib/externalAgentIndex";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<ExternalAgentTrustStatus, string> = {
  Indexed: "border-slate-300 bg-white text-slate-700",
  Claimed: "border-amber-200 bg-amber-50 text-amber-800",
  Verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "FAIVR-native": "border-indigo-200 bg-indigo-50 text-indigo-800",
};

function StatusMark({ status }: { status: ExternalAgentTrustStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium", STATUS_CLASS[status])}>
      {status}
    </span>
  );
}

export function ExternalAgentIndex() {
  return (
    <section id="external-agent-index" className="border-t border-slate-200 pt-10" aria-labelledby="external-agent-index-title">
      <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start">
        <div>
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-slate-500">External Index</p>
            <h2 id="external-agent-index-title" className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Public-source agents waiting for a clean FAIVR claim.
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              These rows are example indexed public-source agents from OKX/Coinbase-style surfaces. They are not live FAIVR registry agents, and they do not use scraped or proprietary marketplace data.
            </p>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1.2fr_0.95fr_0.95fr_0.55fr_0.55fr] gap-0 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500 max-lg:hidden">
              <span>Indexed agent</span>
              <span>Source</span>
              <span>Trust state</span>
              <span>Checked</span>
              <span className="text-right">Claim</span>
            </div>

            <div className="divide-y divide-slate-200">
              {EXTERNAL_INDEXED_AGENTS.map((agent) => (
                <article key={agent.id} className="grid gap-5 px-5 py-5 lg:grid-cols-[1.2fr_0.95fr_0.95fr_0.55fr_0.55fr] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold tracking-tight text-slate-950">{agent.name}</h3>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
                        example seed
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{agent.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {agent.categories.map((category) => (
                        <span key={category} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500">
                          {category}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="text-sm leading-6">
                    <p className="font-medium text-slate-900">{agent.sourceMarketplaceLabel}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{agent.sourceDisclosure}</p>
                  </div>

                  <div>
                    <div className="flex flex-wrap gap-2">
                      {agent.statuses.map((status) => (
                        <StatusMark key={status} status={status} />
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{agent.registryBoundary}</p>
                  </div>

                  <p className="text-sm font-medium text-slate-700">{agent.lastChecked}</p>

                  <div className="lg:text-right">
                    <Link
                      href={`/onboard-agent?claim=${agent.id}`}
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "rounded-md")}
                    >
                      {agent.claimCta}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-5">
                    <p className="text-xs font-medium text-slate-500">Trust overlay</p>
                    <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-3">
                      {agent.trustOverlayBullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2">
                          <CheckCircle2 className="mt-1 h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm" aria-label="External index trust boundary">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <Fingerprint className="h-5 w-5 text-slate-200" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold">Index boundary</p>
              <p className="text-xs text-slate-400">External is not native.</p>
            </div>
          </div>

          <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
            {EXTERNAL_INDEX_DISCLOSURE.map((item) => (
              <li key={item} className="flex gap-3">
                <ShieldCheck className="mt-1 h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="text-sm font-semibold text-white">Trust status legend</p>
            <div className="mt-3 space-y-3">
              {(Object.keys(EXTERNAL_TRUST_STATUS_COPY) as ExternalAgentTrustStatus[]).map((status) => (
                <div key={status} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <StatusMark status={status} />
                  <p className="mt-2 text-xs leading-5 text-slate-400">{EXTERNAL_TRUST_STATUS_COPY[status]}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
