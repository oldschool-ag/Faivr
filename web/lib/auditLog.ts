type OperatorAuditAction = "quote_requests.list" | "quote_requests.update";

type OperatorAuditPayload = {
  action: OperatorAuditAction;
  actor: string;
  authMethod: string;
  ip: string;
  userAgent: string | null;
  requestId?: string;
  agentId?: number;
  status?: string;
  outcome: "success" | "rejected" | "not_found" | "error";
  reason?: string;
};

export function auditOperatorAction(payload: OperatorAuditPayload) {
  console.info(
    JSON.stringify({
      event: "operator_audit",
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}
