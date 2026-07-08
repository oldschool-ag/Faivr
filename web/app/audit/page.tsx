import { ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { COMMIT_ROOT, SITE_STATUS } from "@/lib/site";

const LINKS = [
  { label: "Reviewed Solidity commit", href: `${COMMIT_ROOT}/${SITE_STATUS.reviewedSolidityCommit}` },
  { label: "GitHub repository", href: "https://github.com/oldschoolag/Faivr" },
  { label: "Earlier live parity block", href: `https://basescan.org/block/${SITE_STATUS.liveParityBlock}` },
] as const;

export default function AuditPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-12 sm:py-16">
        <section>
          <Badge variant="success" className="px-4 py-2 text-xs uppercase tracking-[0.22em]">
            Audit status
          </Badge>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl">
            Scoped Solidity remediation review complete.
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            FAIVR&apos;s final remediation follow-up dated {SITE_STATUS.finalRemediationReportDate} closes the remaining
            technical remediation items for the reviewed Solidity snapshot at commit {SITE_STATUS.reviewedSolidityCommit}.
            No open technical remediation findings remain. F-09 is documented as an accepted informational design decision
            about the current validator trust model.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-500">{SITE_STATUS.auditScopeNote}</p>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Card padding="lg" className="border-emerald-200 bg-emerald-50">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            <h2 className="mt-4 text-xl font-semibold text-slate-950">Final remediation review complete</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              The 2026-04-30 follow-up confirms closure of the remaining scoped Solidity remediation work.
            </p>
          </Card>
          <Card padding="lg" className="border-emerald-200 bg-emerald-50">
            <FileCheck2 className="h-5 w-5 text-emerald-700" />
            <h2 className="mt-4 text-xl font-semibold text-slate-950">No open technical findings</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              F-01 through F-08 and F-10 are closed in scope. F-09 remains documented as an accepted informational design decision.
            </p>
          </Card>
          <Card padding="lg" className="border-amber-200 bg-amber-50">
            <h2 className="text-xl font-semibold text-slate-950">Scope boundary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              The final follow-up does not independently re-review live Base deployment or on-chain source-code parity.
              Treat those as separate operational evidence, not as auditor-reviewed closure.
            </p>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card padding="lg">
            <h2 className="text-2xl font-semibold text-slate-950">What changed in the final follow-up</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
              <li>• The reviewed Solidity snapshot is commit {SITE_STATUS.reviewedSolidityCommit}.</li>
              <li>• The remaining technical closure blockers from the prior re-review are closed in scope.</li>
              <li>• Validation trust-model item F-09 remains disclosed as an accepted informational design decision.</li>
              <li>• The report includes targeted test coverage observations for the remediated behaviors.</li>
            </ul>
          </Card>
          <Card padding="lg">
            <h2 className="text-2xl font-semibold text-slate-950">What users should understand</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-600">
              <li>• Smart-contract review scope is not a guarantee of agent quality, operator conduct, or business outcomes.</li>
              <li>• Reputation and verification are decision aids, not insurance.</li>
              <li>• The disclosed validator trust model is not the same thing as contract-enforced independent validation.</li>
              <li>• Blockchain transactions remain irreversible and carry normal on-chain risk.</li>
            </ul>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-slate-950">References</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-between rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                {link.label}
                <ExternalLink className="h-4 w-4" />
              </a>
            ))}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
