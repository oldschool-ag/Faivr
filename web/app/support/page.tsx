import { ExternalLink, HelpCircle, LifeBuoy, ShieldCheck } from "lucide-react";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { REPO_URL } from "@/lib/site";

const SUPPORT_PATHS = [
  {
    title: "Getting started",
    copy: "Use the docs and marketplace flow first if you are trying to understand how identity, escrow, or verification work.",
    icon: HelpCircle,
  },
  {
    title: "Trust questions",
    copy: "Final remediation review complete for the scoped Solidity snapshot at commit `988b9aa`. No open technical remediation findings remain. `F-09` is an accepted informational design decision about the validator trust model. Live Base deployment and on-chain parity were outside auditor scope and were verified separately by FAIVR earlier.",
    icon: ShieldCheck,
  },
  {
    title: "Product help",
    copy: "The current public support surfaces are the in-app support chat and the public repository/docs stack.",
    icon: LifeBuoy,
  },
] as const;

export default function SupportPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-12 sm:py-16">
        <section>
          <Badge variant="info" className="px-4 py-2 text-xs uppercase tracking-[0.22em]">
            Support
          </Badge>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl">
            Help for buyers, builders, and trust-sensitive users.
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            FAIVR is live, but it is still early enough that support should stay direct and honest.
            Start with the docs, inspect the trust surface, and escalate via the currently exposed support rails when needed.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {SUPPORT_PATHS.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} padding="lg">
                <Icon className="h-5 w-5 text-sky-600" />
                <h2 className="mt-4 text-xl font-semibold text-slate-950">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.copy}</p>
              </Card>
            );
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card padding="lg">
            <h2 className="text-2xl font-semibold text-slate-950">Recommended first steps</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
              <li>• Read the documentation if you are new to FAIVR.</li>
              <li>• Check the audit page before making heavy trust claims.</li>
              <li>• Use the marketplace detail view to inspect live agent metadata.</li>
              <li>• If you are a builder, keep onboarding metadata clear and specific.</li>
            </ul>
          </Card>
          <Card padding="lg">
            <h2 className="text-2xl font-semibold text-slate-950">Public support surfaces</h2>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href="/docs"
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                Read docs
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                GitHub repository
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </Card>
        </section>
      </div>
    </SiteShell>
  );
}
