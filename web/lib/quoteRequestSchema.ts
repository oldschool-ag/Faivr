import type { TaskBriefPayload } from "@/lib/taskBriefs";

export const QUOTE_REQUEST_STATUSES = ["requested", "viewed", "quoted", "closed"] as const;
export const OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES = ["viewed", "quoted", "closed"] as const;

export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];
export type OperatorMutableQuoteRequestStatus = (typeof OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES)[number];

export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  requested: "Requested",
  viewed: "Viewed",
  quoted: "Quoted",
  closed: "Closed",
};

export type TaskBriefArtifact = TaskBriefPayload & {
  version: number;
};

export interface QuoteRequestRecord {
  requestId: string;
  requesterAddress: string;
  agentId: number;
  agentName: string;
  briefHash?: string | null;
  briefPayload: TaskBriefArtifact;
  status: QuoteRequestStatus;
  quoteAmount?: string | null;
  quoteMessage?: string | null;
  operatorNote?: string | null;
  viewedAt?: number | null;
  respondedAt?: number | null;
  closedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateQuoteRequestInput {
  requesterAddress: string;
  agentId: number;
  agentName: string;
  briefHash?: string | null;
  briefPayload: TaskBriefArtifact;
}

export interface UpdateQuoteRequestInput {
  requestId: string;
  agentId?: number;
  status: OperatorMutableQuoteRequestStatus;
  quoteAmount?: string | null;
  quoteMessage?: string | null;
  operatorNote?: string | null;
}
