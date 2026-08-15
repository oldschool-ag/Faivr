import { z } from "zod";
import { CONTRACT_VERSION } from "./auth";

export const uuidSchema = z.string().uuid();
export const idSchema = z.string().min(1).max(512);
export const modelIdSchema = z.string().regex(/^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const packageSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const installationStateSchema = z.enum(["selected","payment_pending","entitled","downloading","installing","active","update_available","disabled","uninstall_pending","removed","failed"]);
export const subscriptionStateSchema = z.enum(["checkout_pending","active","past_due","suspended","cancellation_pending_uninstall","cancel_at_period_end","cancelled"]);

const envelope = {
  schemaVersion: z.literal(CONTRACT_VERSION), requestId: idSchema, idempotencyKey: idSchema,
  tenantId: uuidSchema, instanceId: uuidSchema, occurredAt: z.string().datetime(),
};
const lifecycleEnvelope = { ...envelope, installationId:uuidSchema, modelId:modelIdSchema, version:semverSchema };

export const selectPackageSchema = z.object({ ...envelope, faivrAgentModelId: modelIdSchema, faivrPackageVersionId: uuidSchema.optional(), successUrl: z.string().url(), cancelUrl: z.string().url() }).strict();
export const installationSelectionSchema = z.object({ ...envelope, faivrAgentModelId:modelIdSchema, faivrPackageVersionId:uuidSchema.optional() }).strict();
export const installAcknowledgementSchema = z.object({
  ...lifecycleEnvelope, messageType: z.literal("installation.acknowledged"), localAgentDefinitionId: idSchema, packageDigest: sha256Schema,
  activationResult: z.enum(["active", "failed"]), compatibilityVerified: z.boolean(), publisherSignatureVerified: z.boolean(), packageChecksPassed: z.boolean(), activatedAt: z.string().datetime(),
}).strict();
export const updateCheckSchema = z.object({ tenantId: idSchema, installationId: idSchema, currentPackageVersionId: idSchema, companyOsVersion: semverSchema }).strict();
export const uninstallRequestSchema = z.object({ ...envelope, installationId: uuidSchema, faivrAgentModelId: modelIdSchema, faivrPackageVersionId: uuidSchema, reason: z.string().trim().max(500).optional() }).strict();
const effects = z.object({ agentRegistrationAbsent:z.boolean(), schedulesRevoked:z.boolean(), toolGrantsRevoked:z.boolean(), agentSecretsRevoked:z.boolean(), packagePayloadRemoved:z.boolean(), historicalCompanyDataPreserved:z.boolean() }).strict();
const retainedData = z.object({ customerDataPurged:z.literal(false), historicalCompanyData:z.literal("retained_read_only"), backupDisposition:z.literal("retention_policy"), userCopies:z.literal("not_verified"), thirdPartyCopies:z.literal("not_verified") }).strict();
export const archiveReceiptSchema = z.object({ ...lifecycleEnvelope, messageType:z.literal("agent.archived"), receiptId:uuidSchema, localAgentDefinitionId:idSchema, archiveState:z.literal("archived"), billingEffect:z.literal("unchanged"), archiveEffects:z.object({newRunsBlocked:z.literal(true),runtimeBindingDisabled:z.literal(true),schedulesDisabled:z.literal(true),toolGrantsDisabled:z.literal(true),agentSecretsRevoked:z.literal(true),packagePayloadRetained:z.literal(true),historicalCompanyDataPreserved:z.literal(true)}).strict(), retainedData, archivedAt:z.string().datetime(), nonce:idSchema, signature:z.object({keyId:idSchema,algorithm:z.literal("Ed25519"),value:idSchema}).strict() }).strict();
export const uninstallReceiptSchema = z.object({
  ...lifecycleEnvelope, messageType:z.literal("package.uninstalled"), receiptId:uuidSchema, uninstallRequestId:uuidSchema, subscriptionId:uuidSchema,
  localAgentDefinitionId:idSchema, packageDigest:sha256Schema, removedManagedPaths:z.array(idSchema).min(1).refine((v)=>new Set(v).size===v.length,"paths must be unique"), result:z.enum(["completed","partial","failed"]), verifiedEffects:effects, retainedData, completedAt:z.string().datetime(), nonce:idSchema,
  signature:z.object({ keyId:idSchema, algorithm:z.literal("Ed25519"), value:idSchema }).strict(),
}).strict();
export function isAcceptableUninstallReceipt(receipt:z.infer<typeof uninstallReceiptSchema>):boolean { return receipt.result === "completed" && Object.values(receipt.verifiedEffects).every(Boolean); }
export const billingAcknowledgementSchema = z.object({ ...lifecycleEnvelope, messageType:z.literal("billing.stop_acknowledged"), eventId:uuidSchema, receiptId:uuidSchema, subscriptionId:uuidSchema, receiptState:z.enum(["accepted","rejected"]), subscriptionState:subscriptionStateSchema, effectiveAt:z.string().datetime(), rejectionReason:z.string().max(2000).nullable().optional(), signature:z.object({keyId:idSchema,algorithm:z.literal("Ed25519"),value:idSchema}).strict() }).strict();
export type UninstallReceipt = z.infer<typeof uninstallReceiptSchema>;
