import { notFound } from "next/navigation";
import { AgentDetailView } from "@/components/agent/AgentDetailView";

export default async function AgentWorkflowPage(props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const agentId = Number(params.agentId);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    notFound();
  }

  return <AgentDetailView agentId={agentId} />;
}
