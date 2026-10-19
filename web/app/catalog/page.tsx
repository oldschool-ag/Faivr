import type { Metadata } from "next";
import Link from "next/link";
import { FunctionFace } from "@/components/catalog/FunctionFace";
import { SiteShell } from "@/components/layout/SiteShell";
import { comingSoonFunctionForPackageIds, comingSoonFunctions } from "@/data/catalog-coming-soon";
import { CONTACT_EMAIL } from "@/lib/contact";
import { getPublicCatalogState } from "@/lib/publicCatalog";
import { agentTerminology } from "@/lib/publicCopy";

export const metadata: Metadata = {
  title: "Catalog | FAIVR",
  description: "Functions you can hand to governed AI agents.",
  openGraph: { title: "Catalog | FAIVR", description: "Functions you can hand to governed AI agents." },
};

const price = (cents: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
const plannedFor = (item: { workers: { id: string }[] }) => comingSoonFunctionForPackageIds(item.workers.map((agent) => agent.id));
const bobAgentOrder = [
  "faivr.agent.build-merge-gate",
  "faivr.agent.build-ci-fixer",
  "faivr.agent.build-security-reviewer",
  "faivr.agent.build-qa-reviewer",
  "faivr.agent.build-instructions-keeper",
  "faivr.agent.build-issue-writer",
];

function agentNames(item: { workers: { id: string; name: string }[] }, functionSlug: string) {
  if (functionSlug !== "software-delivery") return item.workers.map((agent) => agent.name).join(", ");
  const byId = new Map(item.workers.map((agent) => [agent.id, agent.name]));
  return [
    "Bob",
    ...bobAgentOrder.flatMap((id) => {
      const name = byId.get(id);
      return name ? [name.replace(/^Bob - /, "")] : [];
    }),
  ].join(", ");
}

export default async function Catalog() {
  const { functions, unavailable } = await getPublicCatalogState();
  return <SiteShell><div className="mx-auto max-w-[1220px] px-4 py-14 sm:px-8">
    <p className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[.14em] text-[var(--accent)]">CATALOG</p>
    <h1 className="mt-3 max-w-4xl text-5xl font-extrabold tracking-[-.06em] sm:text-7xl">Functions you can hand to governed AI agents.</h1>
    <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--body)]">Each function has one monthly price and one or more agents. Agents run only on a Truchsess appliance.</p>
    {unavailable && <p className="mt-6 rounded-2xl bg-white p-4 text-sm text-[var(--body)]">Public packages are temporarily unavailable. Coming-soon functions are still shown below.</p>}
    <div className="mt-3 max-w-3xl space-y-1 text-sm leading-6 text-[var(--body)]">
      <p>Price per box and month. A second copy of a function on the same box costs the same again.</p>
      <p><span className="font-bold text-[var(--ink)]">You get:</span> The signed agents listed below, installed and approved on your Truchsess.</p>
      <p className="font-bold text-[var(--ink)]">You subscribe on your Truchsess, not on this site.</p>
      <p>Early access: talk to us to get a Truchsess. Plus VAT where applicable.</p>
    </div>
    <section data-testid="catalog-function-grid" className="mx-auto mt-10 grid w-full max-w-full grid-cols-1 items-stretch gap-5 md:max-w-[764px] md:grid-cols-2 min-[1101px]:max-w-[1156px] min-[1101px]:grid-cols-3">
      {functions.map((item) => {
        const planned = plannedFor(item);
        const functionSlug = planned?.slug ?? item.slug;
        return <article key={item.slug} data-testid="catalog-function-card" className="flex h-full min-w-0 flex-col rounded-[24px] bg-white p-5 shadow-sm">
          <div className="flex min-w-0 items-start gap-4">
            <FunctionFace image={item.image} name={item.name} className="h-14 w-14 shrink-0" />
            <div className="min-w-0 flex-1 py-3">
              <h2 className="truncate text-xl font-extrabold leading-7 tracking-[-.02em]" title={item.name}>{item.name}</h2>
            </div>
          </div>
          <p className="mt-2 truncate text-sm leading-6 text-[var(--body)]" title={agentTerminology(item.description)}>{agentTerminology(item.description)}</p>
          <p className="mt-3 text-xl font-extrabold">{price(item.monthlyPriceCents, item.currency)} <span className="text-sm font-medium text-[var(--muted)]">/ month</span></p>
          <p data-testid="catalog-agent-names" className="mt-3 text-sm leading-5 text-[var(--body)]"><span className="font-bold text-[var(--ink)]">Agents:</span> {agentNames(item, functionSlug)}</p>
          <div className="mt-auto pt-4">
            <Link className="inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white" href={`/catalog/${functionSlug}`}>View function</Link>
          </div>
        </article>;
      })}
    </section>
    <section className="mt-16"><h2 className="text-3xl font-extrabold">Coming soon</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{comingSoonFunctions.filter((item) => !functions.some((available) => plannedFor(available)?.slug === item.slug)).map((item) => <article key={item.slug} className="rounded-[28px] border border-dashed border-[#C9CCE4] bg-white p-6"><p className="text-xs font-bold tracking-[.12em] text-[var(--accent)]">COMING SOON</p><h3 className="mt-3 text-xl font-bold"><Link className="inline-flex min-h-11 min-w-11 items-center" href={`/catalog/${item.slug}`}>{item.name}</Link></h3><p className="mt-3 text-sm leading-6 text-[var(--body)]">{item.summary}</p><div className="mt-5 flex gap-4"><Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/catalog/${item.slug}`}>Details</Link><a className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>Tell me when it is ready</a></div></article>)}</div></section>
    <section className="mt-16 rounded-[28px] bg-white p-7"><h2 className="text-3xl font-extrabold">No Truchsess yet?</h2><p className="mt-3 text-[var(--body)]">Agents run on a Truchsess appliance in your office.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white" href="/how-it-works#contact">Talk to us about a Truchsess</Link></section>
    <section className="mt-16"><h2 className="text-3xl font-extrabold">Questions</h2><dl className="mt-6 grid gap-4 md:grid-cols-3"><div className="rounded-3xl bg-white p-6"><dt className="font-bold">Why can&apos;t I buy here?</dt><dd className="mt-3 text-sm text-[var(--body)]">Buying, connecting to the store and installing happen only on your Truchsess.</dd></div><div className="rounded-3xl bg-white p-6"><dt className="font-bold">How do I cancel?</dt><dd className="mt-3 text-sm text-[var(--body)]">Cancel on your appliance. The agent is removed with a signed receipt.</dd></div><div className="rounded-3xl bg-white p-6"><dt className="font-bold">Who sends the invoice?</dt><dd className="mt-3 text-sm text-[var(--body)]">Polar is the merchant of record and sends the invoice.</dd></div></dl></section>
  </div></SiteShell>;
}
