import { notFound } from "next/navigation";
import { AgentDetailView } from "@/components/agent/AgentDetailView";
import { isHiddenAgentId } from "@/lib/hiddenAgents";

export default async function AgentWorkflowPage(props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const agentId = Number(params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    notFound();
  }
  // F1: a hidden registry entry has no page; its direct URL answers "not found"
  if (isHiddenAgentId(agentId)) {
    notFound();
  }

  return <AgentDetailView agentId={agentId} />;
}
