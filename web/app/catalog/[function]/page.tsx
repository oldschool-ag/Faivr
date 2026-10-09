import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/layout/SiteShell";
import { comingSoonFunctions } from "@/data/catalog-coming-soon";
import { getPublicCatalog } from "@/lib/publicCatalog";
import { CONTACT_EMAIL } from "@/lib/contact";

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function generateMetadata({ params }: { params: Promise<{ function: string }> }): Promise<Metadata> {
  const slug = (await params).function;
  const available = (await getPublicCatalog()).find((item) => item.slug === slug);
  const planned = comingSoonFunctions.find((item) => item.slug === slug);
  const title = `${available?.name ?? planned?.name ?? "Function"} | FAIVR`;
  const description = available?.description ?? planned?.summary ?? "FAIVR function details.";
  return { title, description, openGraph: { title, description } };
}

export default async function FunctionPage({ params }: { params: Promise<{ function: string }> }) {
  const slug = (await params).function;
  const available = (await getPublicCatalog()).find((item) => item.slug === slug);
  const planned = comingSoonFunctions.find((item) => item.slug === slug);
  if (!available && !planned) notFound();
  return <SiteShell><div className="mx-auto max-w-[1220px] px-4 py-14 sm:px-8">
    <Link href="/catalog" className="inline-flex min-h-11 min-w-11 items-center rounded-full bg-white px-3 text-sm font-bold text-[var(--accent)]">← Catalog</Link>
    <p className="mt-8 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[.14em] text-[var(--accent)]">{available ? "AVAILABLE ON TRUCHSESS" : "COMING SOON"}</p>
    <h1 className="mt-3 text-5xl font-extrabold tracking-[-.06em] sm:text-7xl">{available?.name ?? planned?.name}</h1>
    <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--body)]">{available?.description ?? planned?.summary}</p>
    {available ? <><p className="mt-8 text-2xl font-extrabold">{new Intl.NumberFormat("en", { style: "currency", currency: available.currency.toUpperCase() }).format(available.monthlyPriceCents / 100)} / month</p><p className="mt-2 text-sm text-[var(--muted)]">Plus VAT where applicable. Early access: talk to us to get a Truchsess.</p><p className="mt-8 rounded-full bg-white px-5 py-3 text-sm font-bold">You subscribe on your Truchsess, not on this site.</p><section className="mt-10 grid gap-4 md:grid-cols-2">{available.workers.map((agent) => <Link key={agent.id} href={`/agents/${agent.slug || slugify(agent.name)}`} className="rounded-3xl bg-white p-6"><h2 className="text-2xl font-bold">{agent.name}</h2><p className="mt-3 text-[var(--body)]">{agent.role}</p><p className="mt-5 text-sm font-bold">View agent details →</p></Link>)}</section></> : <section className="mt-10 rounded-3xl border border-dashed border-[#C9CCE4] bg-white p-7"><h2 className="text-2xl font-bold">Agents planned for this function</h2><ul className="mt-4 space-y-2 text-[var(--body)]">{planned?.agents.map((agent) => <li key={agent}><Link className="inline-flex min-h-11 min-w-11 items-center font-bold underline" href={`/agents/${slugify(agent)}`}>{agent}</Link></li>)}</ul><p className="mt-6 text-sm text-[var(--body)]">Package details will be published when this function is available.</p><a className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 font-semibold text-white" href={`mailto:${CONTACT_EMAIL}`}>Tell me when it is ready</a></section>}
  </div></SiteShell>;
}
