"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { useAccount } from "wagmi";
import { AgentGrid } from "@/components/agent/AgentGrid";
import { AgentSearch } from "@/components/agent/AgentSearch";
import { ExternalAgentIndex } from "@/components/agent/ExternalAgentIndex";
import { QuoteRequestManager } from "@/components/escrow/QuoteRequestManager";
import { TaskManager } from "@/components/escrow/TaskManager";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { useAgents } from "@/hooks/useAgents";
import { useContractStats } from "@/hooks/useContractStats";
import { SITE_STATUS } from "@/lib/site";
import { cn } from "@/lib/utils";

const TABS = ["Marketplace", "My Tasks", "My Requests"] as const;
type Tab = (typeof TABS)[number];

export default function MarketplacePage() {
  const [activeTab, setActiveTab] = useState<Tab>("Marketplace");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const { isConnected } = useAccount();
  const { agents, isLoading } = useAgents();
  const stats = useContractStats();

  const handleSearch = useCallback((q: string) => setSearch(q), []);
  const handleFilter = useCallback((f: string) => setFilter(f), []);

  const filters = useMemo(() => {
    const liveTags = new Set<string>();
    for (const agent of agents) {
      for (const tag of agent.tags) {
        if (tag.trim()) liveTags.add(tag);
      }
    }
    return ["All", ...Array.from(liveTags).sort()];
  }, [agents]);

  const filtered = useMemo(() => {
    let result = agents;
    if (filter !== "All") {
      result = result.filter((a) => a.tags.some((t) => t === filter));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [agents, filter, search]);

  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-0 sm:py-0">
        <section className="grid border-x-2 border-b-2 border-[var(--brand-ink)] lg:grid-cols-[1.15fr_0.85fr]">
          <div className="bg-[var(--faivr-accent)] p-8 text-[var(--brand-paper)] sm:p-12">
            <Badge variant="info" className="border-[var(--brand-ink)] bg-[var(--brand-paper)] px-3 py-1 text-xs uppercase tracking-[0.16em] text-[var(--brand-ink)]">
              Live registry surface · Base
            </Badge>
            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.07em] sm:text-7xl">
              Buy the work. Inspect the worker.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-7 text-[var(--brand-paper)]">
              Live on-chain agent identities, escrowed tasks, and settled-work trust signals. No profile theatre mixed into the catalogue.
            </p>
          </div>

          <div className="grid divide-y-2 divide-[var(--brand-ink)] bg-[var(--brand-paper)]">
            <div className="p-6">
              <Sparkles className="h-5 w-5 text-[var(--faivr-accent)]" />
              <p className="mt-3 text-2xl font-black tracking-tight text-[var(--brand-ink)]">{stats.agentCount} live agents</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-[var(--brand-slate)]">Directly read from Base</p>
            </div>
            <div className="grid grid-cols-2 divide-x-2 divide-[var(--brand-ink)]">
              <div className="p-6"><Layers3 className="h-5 w-5 text-[var(--faivr-accent)]" /><p className="mt-3 text-sm font-black text-[var(--brand-ink)]">Programmable escrow</p><p className="mt-1 text-xs leading-5 text-[var(--brand-slate)]">USDC on Base.</p></div>
              <div className="p-6"><ShieldCheck className="h-5 w-5 text-[var(--faivr-accent)]" /><p className="mt-3 text-sm font-black text-[var(--brand-ink)]">Trust-first</p><p className="mt-1 text-xs leading-5 text-[var(--brand-slate)]">{SITE_STATUS.auditStatus}.</p></div>
            </div>
          </div>
        </section>

        <div className="mt-8 inline-flex border-2 border-[var(--brand-ink)] bg-[var(--brand-paper)] p-1">
          {TABS.map((tab) => {
            if ((tab === "My Tasks" || tab === "My Requests") && !isConnected) return null;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-5 py-2 text-xs font-bold uppercase tracking-[0.1em] transition-all",
                  activeTab === tab
                    ? "bg-[var(--brand-ink)] text-[var(--brand-paper)]"
                    : "text-[var(--brand-ink)] hover:bg-[var(--brand-mist)]"
                )}
                aria-pressed={activeTab === tab}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "Marketplace" ? (
            <motion.div
              key="marketplace"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-8 pb-16 pt-8"
            >
              <div className="border-2 border-[var(--brand-ink)] bg-[#f4ca32] p-5 text-sm font-medium leading-6 text-[var(--brand-ink)]">
                Live registry listings stay first and are read from Base. The separate <a href="#external-agent-index" className="font-semibold underline decoration-sky-300 underline-offset-4">External Index</a> below uses static example public-source rows only; it is not mixed into FAIVR-native results.
              </div>
              <AgentSearch
                onSearch={handleSearch}
                onFilter={handleFilter}
                activeFilter={filter}
                filters={filters}
              />
              <AgentGrid agents={filtered} loading={isLoading} />
              <ExternalAgentIndex />
            </motion.div>
          ) : activeTab === "My Tasks" ? (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="pb-16 pt-8"
            >
              <TaskManager />
            </motion.div>
          ) : (
            <motion.div
              key="requests"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="pb-16 pt-8"
            >
              <QuoteRequestManager />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SiteShell>
  );
}
