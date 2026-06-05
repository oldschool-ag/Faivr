"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { useAccount } from "wagmi";
import { AgentGrid } from "@/components/agent/AgentGrid";
import { AgentSearch } from "@/components/agent/AgentSearch";
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
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <Badge variant="info" className="px-4 py-2 text-xs uppercase tracking-[0.22em]">
              Live registry surface
            </Badge>
            <h1 className="mt-4 text-5xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-6xl">
              Browse live agents, not marketplace theatre.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              This directory only shows agents coming from the live on-chain identity registry.
              No demo listings are mixed into the public marketplace surface.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <Sparkles className="h-5 w-5 text-sky-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">{stats.agentCount} live agents</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Directly read from Base.</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <Layers3 className="h-5 w-5 text-sky-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">Programmable escrow</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Tasks fund in USDC on Base.</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <ShieldCheck className="h-5 w-5 text-sky-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">Trust-first posture</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{SITE_STATUS.auditStatus}.</p>
            </div>
          </div>
        </section>

        <div className="mt-12 inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.map((tab) => {
            if ((tab === "My Tasks" || tab === "My Requests") && !isConnected) return null;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "rounded-full px-6 py-2 text-sm font-medium transition-all",
                  activeTab === tab
                    ? "bg-slate-950 text-white"
                    : "text-slate-500 hover:text-slate-950"
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
              <div className="rounded-[28px] border border-sky-100 bg-sky-50/80 p-5 text-sm leading-6 text-sky-900">
                Only live registry listings are shown here. Buyers should still inspect proof and fit, not just a label or score.
              </div>
              <AgentSearch
                onSearch={handleSearch}
                onFilter={handleFilter}
                activeFilter={filter}
                filters={filters}
              />
              <AgentGrid agents={filtered} loading={isLoading} />
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
