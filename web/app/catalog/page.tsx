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

export default async function Catalog() {
  const { functions, unavailable } = await getPublicCatalogState();
  return <SiteShell><div className="mx-auto max-w-[1220px] px-4 py-14 sm:px-8">
    <p className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[.14em] text-[var(--accent)]">CATALOG</p>
    <h1 className="mt-3 max-w-4xl text-5xl font-extrabold tracking-[-.06em] sm:text-7xl">Functions you can hand to governed AI agents.</h1>
    <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--body)]">Each function has one monthly price and one or more agents. Agents run only on a Truchsess appliance.</p>
    <p className="mt-2 max-w-2xl text-sm text-[var(--body)]">Price per box and month. A second copy of a function on the same box costs the same again.</p>
    {unavailable && <p className="mt-6 rounded-2xl bg-white p-4 text-sm text-[var(--body)]">Public packages are temporarily unavailable. Coming-soon functions are still shown below.</p>}
    <section data-testid="catalog-function-grid" className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {functions.map((item) => {
        const planned = plannedFor(item);
        const functionSlug = planned?.slug ?? item.slug;
        return <article key={item.slug} data-testid="catalog-function-card" className="flex min-w-0 flex-col rounded-[24px] bg-white p-5 shadow-sm">
          <div className="flex min-w-0 items-start gap-4">
            <FunctionFace image={item.image} name={item.name} className="h-14 w-14 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold leading-tight tracking-[-.02em]"><Link className="inline-flex min-h-11 min-w-0 items-center break-words" href={`/catalog/${functionSlug}`}>{item.name}</Link></h2>
            </div>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--body)]">{agentTerminology(item.description)}</p>
          <p className="mt-3 text-xl font-extrabold">{price(item.monthlyPriceCents, item.currency)} <span className="text-sm font-medium text-[var(--muted)]">/ month</span></p>
          <div className="mt-3 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 rounded-2xl bg-[var(--page)] p-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold">You get</h3>
              <p className="mt-1 text-sm leading-5 text-[var(--body)]">The signed agents listed below, installed and approved on your Truchsess.</p>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold">Agents</h3>
              <ul className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1">{item.workers.map((agent) => <li key={agent.id} className="min-w-0"><Link className="inline-flex min-h-11 min-w-0 items-center break-words text-sm font-bold underline decoration-[var(--line)] underline-offset-4" href={`/agents/${agent.slug}`}>{agent.name}</Link></li>)}</ul>
            </div>
          </div>
          <div className="mt-auto pt-3">
            <p className="text-sm font-bold">You subscribe on your Truchsess, not on this site.</p>
            <p className="mt-1 text-sm leading-5 text-[var(--body)]">Early access: talk to us to get a Truchsess. Plus VAT where applicable.</p>
            <Link className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white" href={`/catalog/${functionSlug}`}>View function</Link>
          </div>
        </article>;
      })}
    </section>
    <section className="mt-16"><h2 className="text-3xl font-extrabold">Coming soon</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{comingSoonFunctions.filter((item) => !functions.some((available) => plannedFor(available)?.slug === item.slug)).map((item) => <article key={item.slug} className="rounded-[28px] border border-dashed border-[#C9CCE4] bg-white p-6"><p className="text-xs font-bold tracking-[.12em] text-[var(--accent)]">COMING SOON</p><h3 className="mt-3 text-xl font-bold"><Link className="inline-flex min-h-11 min-w-11 items-center" href={`/catalog/${item.slug}`}>{item.name}</Link></h3><p className="mt-3 text-sm leading-6 text-[var(--body)]">{item.summary}</p><div className="mt-5 flex gap-4"><Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/catalog/${item.slug}`}>Details</Link><a className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`mailto:${CONTACT_EMAIL}`}>Tell me when it is ready</a></div></article>)}</div></section>
    <section className="mt-16 rounded-[28px] bg-white p-7"><h2 className="text-3xl font-extrabold">No Truchsess yet?</h2><p className="mt-3 text-[var(--body)]">Agents run on a Truchsess appliance in your office.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white" href="/how-it-works#contact">Talk to us about a Truchsess</Link></section>
    <section className="mt-16"><h2 className="text-3xl font-extrabold">Questions</h2><dl className="mt-6 grid gap-4 md:grid-cols-3"><div className="rounded-3xl bg-white p-6"><dt className="font-bold">Why can&apos;t I buy here?</dt><dd className="mt-3 text-sm text-[var(--body)]">Buying, connecting to the store and installing happen only on your Truchsess.</dd></div><div className="rounded-3xl bg-white p-6"><dt className="font-bold">How do I cancel?</dt><dd className="mt-3 text-sm text-[var(--body)]">Cancel on your appliance. The agent is removed with a signed receipt.</dd></div><div className="rounded-3xl bg-white p-6"><dt className="font-bold">Who sends the invoice?</dt><dd className="mt-3 text-sm text-[var(--body)]">Polar is the merchant of record and sends the invoice.</dd></div></dl></section>
  </div></SiteShell>;
}
