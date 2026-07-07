import { z } from "zod";
import {
  OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES,
  type CreateQuoteRequestInput,
  type UpdateQuoteRequestInput,
} from "@/lib/quoteRequestSchema";

const ethereumAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address")
  .transform((value) => value.toLowerCase());

const positiveAgentIdSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const trimmedString = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength);

const optionalTrimmedString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .nullable()
    .transform((value) => {
      if (typeof value !== "string") return null;
      return value.length > 0 ? value : null;
    });

const optionalBriefString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return undefined;
      return value.length > 0 ? value : undefined;
    });

const taskBriefPayloadSchema = z.object({
  version: z.literal(1),
  agentId: positiveAgentIdSchema,
  agentName: trimmedString(160),
  title: trimmedString(160),
  objective: trimmedString(4000),
  expectedOutput: optionalBriefString(2000),
  acceptanceCriteria: optionalBriefString(2000),
  amount: optionalBriefString(80),
  tokenSymbol: trimmedString(24),
  deadlineLabel: trimmedString(120),
  pricingMode: optionalBriefString(80),
});

export const createQuoteRequestSchema = z
  .object({
    requesterAddress: ethereumAddressSchema,
    agentId: positiveAgentIdSchema,
    agentName: trimmedString(160),
    briefHash: optionalTrimmedString(160).optional(),
    briefPayload: taskBriefPayloadSchema,
  })
  .superRefine((payload, ctx) => {
    if (payload.briefPayload.agentId !== payload.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["briefPayload", "agentId"],
        message: "briefPayload.agentId must match agentId",
      });
    }
  });

export const updateQuoteRequestSchema = z.object({
  requestId: z
    .string()
    .trim()
    .regex(/^qr_[A-Za-z0-9_-]+$/, "Expected a quote request id"),
  agentId: positiveAgentIdSchema.optional(),
  status: z.enum(OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES),
  quoteAmount: optionalTrimmedString(80).optional(),
  quoteMessage: optionalTrimmedString(4000).optional(),
  operatorNote: optionalTrimmedString(2000).optional(),
});

export function parseCreateQuoteRequestPayload(payload: unknown): CreateQuoteRequestInput | null {
  const result = createQuoteRequestSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function parseUpdateQuoteRequestPayload(payload: unknown): UpdateQuoteRequestInput | null {
  const result = updateQuoteRequestSchema.safeParse(payload);
  if (!result.success) return null;

  if (result.data.status === "quoted" && !result.data.quoteMessage) {
    return null;
  }

  return result.data;
}

export function parseAgentIdParam(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseRequesterAddressParam(value: string | null): string | null {
  const result = ethereumAddressSchema.safeParse(value);
  return result.success ? result.data : null;
}
