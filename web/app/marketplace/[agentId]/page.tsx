import { notFound } from "next/navigation";
import { AgentDetailView } from "@/components/agent/AgentDetailView";

export default function AgentWorkflowPage({ params }: { params: { agentId: string } }) {
  const agentId = Number(params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    notFound();
  }

  return <AgentDetailView agentId={agentId} />;
}
