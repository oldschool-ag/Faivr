import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";
import { comingSoonFunctionForPackageIds, comingSoonFunctions } from "@/data/catalog-coming-soon";
import { getPublicCatalogState } from "@/lib/publicCatalog";

export const metadata: Metadata = {
  title: "FAIVR — The store for Truchsess",
  description: "Governed AI agents for your company. Browse the catalog and subscribe on your own Truchsess appliance.",
  openGraph: { title: "FAIVR — The store for Truchsess", description: "Governed AI agents for your company." },
};

const steps = [
  ["Get a Truchsess", "A small computer in your office. Your agents run on it, each in its own sandbox."],
  ["Connect it to the store", "One code links your appliance to this catalog."],
  ["Subscribe on the appliance", "Choose a function on your Truchsess. Payments are handled by Polar, the merchant of record."],
  ["Approve and install", "You see every permission in plain words before installation. Your appliance checks the package."],
] as const;
const rules = [
  ["Signed, or not installed", "Your appliance checks the publisher signature and package digest before it installs an agent."],
  ["Only what you allow", "You approve each requested permission. Your policy decides what the agent may do."],
  ["Nothing on its own", "Agents act only on a task someone started."],
  ["Every run on the record", "Your appliance reports every run and what it cost."],
] as const;
const primary = "inline-flex min-h-[50px] items-center justify-center rounded-full bg-[var(--ink)] px-6 py-3 font-semibold text-white";
const secondary = "inline-flex min-h-[50px] items-center justify-center rounded-full border border-[#DADCEB] bg-white px-6 py-3 font-semibold";
const label = "inline-flex rounded-full bg-white px-3 py-1 text-[13px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]";
const price = (cents: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export default async function Home() {
  const { functions, unavailable } = await getPublicCatalogState();
  const featured = functions[0];
  const featuredPlan = featured && comingSoonFunctionForPackageIds(featured.workers.map((agent) => agent.id));
  const planned = comingSoonFunctions[0];
  const worker = featured?.workers[0];
  return (
    <SiteShell>
      <section className="mx-auto grid max-w-[1220px] items-center gap-12 px-4 pb-16 pt-12 sm:px-8 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="min-w-0">
          <p className={label + " border border-[#DADCEB] px-4 py-2"}>THE STORE FOR TRUCHSESS</p>
          <h1 className="mt-7 text-[46px] font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-[64px] lg:text-[72px]">Governed AI agents for your company.</h1>
          <p className="mt-7 max-w-[580px] text-xl leading-[1.6] text-[var(--body)]">FAIVR is Old School&apos;s catalog of AI agents. Each one runs on your own Truchsess appliance, does only what you allow, and reports every run and what it cost.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/catalog" className={primary}>Browse the catalog</Link>
            <Link href="/how-it-works" className={secondary}>How it works</Link>
          </div>
        </div>
        <aside aria-label="Featured function" className="min-w-0 rounded-[32px] bg-white p-3.5 shadow-[0_30px_60px_rgba(30,32,70,0.10)]">
          <div className="flex min-h-[420px] flex-col gap-6 rounded-3xl bg-[var(--ink)] p-6 text-[#E9EAF5] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#A9ACC6]">Featured function</p>
              <span className="rounded-full bg-[#2A2C3D] px-3 py-1.5 text-xs font-bold">{featured ? "Available on Truchsess" : "Coming soon"}</span>
            </div>
            <div>
              <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-white">{featuredPlan?.name ?? featured?.name ?? planned.name}</h2>
              <p className="mt-2 text-[#C3C5DA]">with {featured ? featured.workers.map(item => item.name).join(", ") : planned.agents.join(", ")}</p>
            </div>
            <p className="leading-7 text-[#C3C5DA]">{featuredPlan?.summary ?? featured?.description ?? planned.summary}</p>
            <dl className="grid grid-cols-2 gap-3">
              {featured && <div className="rounded-2xl bg-[#1D1F2C] p-4"><dt className="text-xs text-[#A9ACC6]">Price</dt><dd className="mt-1 font-bold">{price(featured.monthlyPriceCents, featured.currency)} / month</dd><p className="mt-2 text-xs leading-5 text-[#C3C5DA]">Early access: talk to us to get a Truchsess.</p></div>}
              {worker && <div className="rounded-2xl bg-[#1D1F2C] p-4"><dt className="text-xs text-[#A9ACC6]">Permissions</dt><dd className="mt-1 font-bold">{worker.permissions.length}, you approve</dd></div>}
              <div className="rounded-2xl bg-[#1D1F2C] p-4"><dt className="text-xs text-[#A9ACC6]">Runs on</dt><dd className="mt-1 font-bold">Your Truchsess</dd></div>
              <div className="rounded-2xl bg-[#1D1F2C] p-4"><dt className="text-xs text-[#A9ACC6]">Publisher</dt><dd className="mt-1 font-bold">{worker?.publisherName ?? "Old School GmbH"}</dd></div>
            </dl>
            {worker && <p className="break-all font-mono text-xs leading-6 text-[#A9ACC6]">{worker.publisherKeyId}<br />{worker.digest}</p>}
            <Link className="mt-auto inline-flex min-h-11 items-center self-start font-semibold text-white underline underline-offset-4" href={`/catalog/${featuredPlan?.slug ?? featured?.slug ?? planned.slug}`}>View function details</Link>
          </div>
        </aside>
      </section>

      <section aria-labelledby="catalog-title" className="mx-auto max-w-[1220px] px-4 py-12 sm:px-8 sm:pb-20">
        <p className={label}>Catalog</p>
        <h2 id="catalog-title" className="mt-3 text-4xl font-extrabold tracking-[-0.025em] sm:text-[44px]">Hire by function, not by hour.</h2>
        {unavailable && <p role="status" className="mt-4 max-w-2xl text-[var(--muted)]">The available catalog is temporarily unavailable. You can still explore the functions in preparation.</p>}
        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          {functions.map(item => <article key={item.slug} className="rounded-[28px] border border-[var(--line)] bg-white p-7 sm:p-9">
            <h3 className="text-[28px] font-extrabold">{item.name}</h3>
            <p className="mt-3 leading-7 text-[var(--body)]">{item.description}</p>
            <p className="mt-4 text-2xl font-extrabold">{price(item.monthlyPriceCents, item.currency)} <span className="text-base font-medium text-[var(--muted)]">/ month</span></p>
            <p className="mt-2 text-sm text-[var(--muted)]">Plus VAT where applicable. Early access: talk to us to get a Truchsess.</p>
            <Link className={primary + " mt-6"} href={`/catalog/${item.slug}`}>View details</Link>
          </article>)}
          <article className="flex min-h-[230px] flex-col justify-center rounded-[28px] border-2 border-dashed border-[#C9CCE4] p-7 sm:p-9">
            <h3 className="text-[26px] font-extrabold">More functions in preparation</h3>
            <p className="mt-3 max-w-xl leading-7 text-[var(--muted)]">Explore the planned functions and tell us which work you want to hand to a governed AI agent.</p>
            <Link href="/catalog" className="mt-4 inline-flex min-h-11 items-center self-start rounded-full bg-white px-4 font-bold text-[var(--accent)]">Explore the catalog →</Link>
          </article>
        </div>
      </section>

      <section aria-labelledby="steps-title" className="bg-white">
        <div className="mx-auto max-w-[1220px] px-4 py-16 sm:px-8 sm:py-20">
          <p className={label}>How it works</p>
          <h2 id="steps-title" className="mt-3 max-w-3xl text-4xl font-extrabold tracking-[-0.025em] sm:text-[44px]">From order to first result in four steps.</h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([title,copy], index) => <li key={title} className="rounded-3xl bg-[var(--page)] p-7">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ink)] font-extrabold text-white">{index + 1}</span>
              <h3 className="mt-5 text-xl font-extrabold">{title}</h3>
              <p className="mt-3 leading-7 text-[var(--body)]">{copy}</p>
            </li>)}
          </ol>
          <Link href="/how-it-works" className="mt-6 inline-flex min-h-11 items-center font-bold text-[var(--accent)]">How it works in detail →</Link>
        </div>
      </section>

      <section aria-labelledby="trust-title" className="mx-auto max-w-[1220px] px-4 py-16 sm:px-8 sm:py-20">
        <p className={label}>Trust</p>
        <h2 id="trust-title" className="mt-3 text-4xl font-extrabold tracking-[-0.025em] sm:text-[44px]">What &quot;governed&quot; means.</h2>
        <p className="mt-4 max-w-2xl text-lg leading-7 text-[var(--muted)]">Four rules your appliance enforces for every agent from this store.</p>
        <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {rules.map(([title,copy]) => <article key={title} className="rounded-3xl bg-white p-7">
            <h3 className="text-xl font-extrabold">{title}</h3><p className="mt-3 leading-7 text-[var(--body)]">{copy}</p>
          </article>)}
        </div>
        <div className="mt-7 flex flex-wrap gap-3 text-sm">
          <span className="max-w-full rounded-full border border-[#DADCEB] bg-white px-4 py-3"><span className="break-all font-mono text-xs">ed25519-d0ffc3c27628df9f</span> publisher key</span>
          <span className="rounded-full border border-[#DADCEB] bg-white px-4 py-3">Payments by Polar, merchant of record</span>
          <a className="inline-flex min-h-11 items-center rounded-full border border-[#DADCEB] bg-white px-4 py-3" href="https://github.com/oldschool-ag/Faivr">Store code: open source on GitHub</a>
        </div>
      </section>
    </SiteShell>
  );
}
