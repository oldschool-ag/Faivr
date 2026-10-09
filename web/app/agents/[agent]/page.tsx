import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/layout/SiteShell";
import { CONTACT_EMAIL } from "@/lib/contact";
import { comingSoonFunctionForPackageIds, comingSoonFunctions } from "@/data/catalog-coming-soon";
import { getPublicCatalog } from "@/lib/publicCatalog";
import { describePermission, NEVER_PERMISSIONS } from "@/lib/publicPermissions";
import { agentTerminology } from "@/lib/publicCopy";

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const plannedAgentForSlug = (slug: string) => comingSoonFunctions.flatMap((item) => item.agents.map((name) => ({ function: item, name }))).find((agent) => slugify(agent.name) === slug);
const availableAgentForSlug = (functions: Awaited<ReturnType<typeof getPublicCatalog>>, slug: string) => {
  const direct = functions.flatMap((item) => item.workers.map((agent) => ({ function: item, ...agent }))).find((agent) => agent.slug === slug);
  if (direct) return direct;
  const planned = plannedAgentForSlug(slug);
  const mappedFunction = planned && functions.find((item) => comingSoonFunctionForPackageIds(item.workers.map((agent) => agent.id))?.slug === planned.function.slug);
  const aliasPackageId = planned?.function.agentAliases?.[planned.name];
  const fallback = mappedFunction && mappedFunction.workers.length === 1 && planned?.function.agents.length === 1 ? mappedFunction.workers[0] : undefined;
  const mappedAgent = mappedFunction && (mappedFunction.workers.find((agent) => slugify(agent.name) === slug) ?? (aliasPackageId ? mappedFunction.workers.find((agent) => agent.id === aliasPackageId) : fallback));
  return mappedFunction && mappedAgent ? { function: mappedFunction, ...mappedAgent } : undefined;
};

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }): Promise<Metadata> {
  const slug = (await params).agent;
  const available = availableAgentForSlug(await getPublicCatalog(), slug);
  const planned = plannedAgentForSlug(slug);
  const title = `${available?.name ?? planned?.name ?? "Agent"} | FAIVR`;
  const description = available ? agentTerminology(available.role) : "Planned governed AI agent for your Truchsess.";
  return { title, description, openGraph: { title, description } };
}

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const slug = (await params).agent;
  const available = availableAgentForSlug(await getPublicCatalog(), slug);
  const planned = plannedAgentForSlug(slug);
  if (!available && !planned) notFound();
  if (planned && !available) return <SiteShell><div className="mx-auto max-w-[900px] px-4 py-14 sm:px-8"><Link href={`/catalog/${planned.function.slug}`} className="inline-flex min-h-11 min-w-11 items-center rounded-full bg-white px-3 text-sm font-bold text-[var(--accent)]">← {planned.function.name}</Link><p className="mt-8 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold tracking-[.14em] text-[var(--accent)]">COMING SOON</p><h1 className="mt-3 text-5xl font-extrabold">{planned.name}</h1><p className="mt-5 text-lg text-[var(--body)]">{planned.function.summary}</p><p className="mt-8 rounded-3xl bg-white p-6 text-[var(--body)]">Permissions, example tasks, proof of origin, and package details will be published with the package.</p><a className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white" href={`mailto:${CONTACT_EMAIL}`}>Tell me when it is ready</a></div></SiteShell>;
  if (!available) notFound();
  return <SiteShell><div className="mx-auto max-w-[900px] px-4 py-14 sm:px-8"><Link href={`/catalog/${comingSoonFunctionForPackageIds(available.function.workers.map((agent) => agent.id))?.slug ?? available.function.slug}`} className="inline-flex min-h-11 min-w-11 items-center rounded-full bg-white px-3 text-sm font-bold text-[var(--accent)]">← {available.function.name}</Link><h1 className="mt-8 text-5xl font-extrabold">{available.name}</h1><p className="mt-4 text-lg text-[var(--body)]">{agentTerminology(available.role)}</p><section className="mt-10 rounded-3xl bg-white p-7"><h2 className="text-2xl font-bold">{available.permissions.length} permissions. You approve each one.</h2><ul className="mt-4 space-y-2 text-[var(--body)]">{available.permissions.map((permission) => { const slotId = permission.match(/:\{([^{}]+)\}$/)?.[1]; const slot = slotId ? available.slots?.find((item) => item.id === slotId) : undefined; return <li key={permission}>{describePermission(permission, slot ? !slot.required : false, slot?.question)}</li>; })}</ul><p className="mt-6 text-sm font-bold">Never: {NEVER_PERMISSIONS.join("; ").toLowerCase()}.</p></section><section className="mt-8 rounded-3xl bg-[var(--ink)] p-7 text-[var(--dark-text)]"><p className="text-xs font-bold tracking-[.14em]">PROOF OF ORIGIN · SIGNED</p><p className="mt-5">Publisher: {available.publisherName}</p><p>Package id: {available.id}</p><p>Version: {available.version}</p><p className="font-mono text-sm break-all">Publisher key: {available.publisherKeyId}<br />Package digest: {available.digest}</p><p className="mt-5 text-sm text-[#C3C5DA]">Your Truchsess checks the signature and this digest before it installs the agent. The same digest is shown on your appliance.</p></section><p className="mt-8 rounded-3xl bg-white p-6 font-bold">Subscribe on your Truchsess, not on this site.</p></div></SiteShell>;
}
