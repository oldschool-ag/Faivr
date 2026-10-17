import { z } from "zod";
import { CONTRACT_VERSION } from "./auth";
import { idSchema, modelIdSchema, uuidSchema } from "./schemas";

/** Store requests carry the same envelope as every other locked V1 mutation. */
const envelope = {
  schemaVersion: z.literal(CONTRACT_VERSION),
  requestId: idSchema,
  idempotencyKey: idSchema,
  tenantId: uuidSchema,
  instanceId: uuidSchema,
  occurredAt: z.string().datetime(),
};

export const bundleIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const copyNumberSchema = z.number().int().min(1).max(10_000);

/** Enrolment is the one unsigned call: the appliance has no enrolled key yet. */
export const enrolmentRequestSchema = z.object({
  enrolmentCode: z.string().trim().min(12).max(200),
  appliancePublicKeyPem: z.string().min(1).max(8 * 1024),
  label: z.string().trim().max(120).optional(),
}).strict();

export const storeCheckoutSchema = z.object({
  ...envelope,
  bundleId: bundleIdSchema,
  copyNumber: copyNumberSchema.optional(),
  installationId: uuidSchema.optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
}).strict().refine((value) => !(value.copyNumber && value.installationId), { message: "copy_number_or_installation_id" });

export const storeInstallationSchema = z.object({
  ...envelope,
  bundleId: bundleIdSchema,
  faivrAgentModelId: modelIdSchema,
  subscriptionId: uuidSchema.optional(),
  copyNumber: copyNumberSchema.optional(),
  installationId: uuidSchema.optional(),
}).strict();

export const storeCancelSchema = z.object({
  ...envelope,
  subscriptionId: uuidSchema,
}).strict();

export type EnrolmentRequest = z.infer<typeof enrolmentRequestSchema>;
