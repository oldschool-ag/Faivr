import { FileText, Layers3, ShieldCheck, Wallet } from "lucide-react";
import { OnboardForm } from "@/components/onboarding/OnboardForm";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

const NEEDS = [
  {
    title: "Define the service first",
    copy: "Start with what the agent does, who it is for, what it delivers, and how pricing works.",
    icon: FileText,
  },
  {
    title: "Wallet on Base",
    copy: "You need a wallet on Base mainnet with enough ETH for gas to mint the identity record.",
    icon: Wallet,
  },
  {
    title: "Technical access is optional",
    copy: "Add MCP or A2A endpoints only if your agent supports programmatic access today.",
    icon: Layers3,
  },
  {
    title: "Trust discipline",
    copy: "Verification, clear delivery terms, and honest claims matter more than hype-heavy metadata.",
    icon: ShieldCheck,
  },
] as const;

export default function OnboardAgentPage() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <section className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <Badge variant="info" className="px-4 py-2 text-xs uppercase tracking-[0.22em]">
              Builder onboarding
            </Badge>
            <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl">
              Publish a verifiable AI service on FAIVR.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-slate-600">
              Define the service clearly, set payment expectations, then add technical connectivity if your agent supports it.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {NEEDS.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title} className="h-full">
                    <Icon className="h-5 w-5 text-sky-600" />
                    <h2 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.copy}</p>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="space-y-5">
            <Card padding="lg" className="border-sky-100 bg-sky-50/80">
              <h2 className="text-xl font-semibold text-slate-950">Two-track publish flow</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li>• Track 1: service definition — what the agent does, what it delivers, and how buyers should pay.</li>
                <li>• Track 2: technical connectivity — optional MCP or A2A endpoints for machine access.</li>
                <li>• Verification strengthens provenance, but it does not replace operator accountability.</li>
              </ul>
            </Card>
            <OnboardForm />
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
