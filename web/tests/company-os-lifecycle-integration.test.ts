import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder=vi.hoisted(()=>({pool:null as unknown as import("pg").Pool}));
vi.mock("@/lib/postgres",()=>({getPgPool:()=>holder.pool}));

import { archiveInstallation, acknowledgeInstall, acceptUninstallReceipt, confirmBillingStoppedByStripe, installationForTenant, markCancellationPending, markCheckoutFailed, markEntitled, recordCheckout, requestUninstall, selectPackage } from "@/lib/companyOs/store";
import { createCheckoutSession, scheduleSubscriptionCancellation } from "@/lib/companyOs/stripe";
import type { UninstallReceipt } from "@/lib/companyOs/schemas";

const tenantId="11111111-1111-4111-8111-111111111111";
const instanceId="22222222-2222-4222-8222-222222222222";
const versionId="33333333-3333-4333-8333-333333333333";
const modelId="faivr.agent.thea-blueprint";
const version="1.0.0";
const digest=`sha256:${"a".repeat(64)}`;

describe("ordered Company OS marketplace lifecycle",()=>{
  beforeEach(async()=>{
    const db=newDb();
    db.public.none(`
      CREATE TABLE company_os_packages(id text PRIMARY KEY,slug text,name text,summary text,status text);
      CREATE TABLE company_os_package_versions(id uuid PRIMARY KEY,package_id text,version text,status text,manifest jsonb,publisher_key_id text,publisher_signature text,artifact_url text,artifact_sha256 text,monthly_price_cents integer,stripe_price_id text,min_company_os_version text,published_at timestamptz);
      CREATE TABLE company_os_installations(id uuid PRIMARY KEY,tenant_id uuid,package_id text,desired_version_id uuid,installed_version_id uuid,subscription_id uuid,checkout_session_id uuid,local_agent_definition_id text,installation_state text,subscription_state text,stripe_checkout_session_id text,stripe_subscription_id text,entitled_at timestamptz,installed_at timestamptz,uninstall_request_id uuid,uninstall_requested_at timestamptz,receipt_accepted_at timestamptz,billing_cancel_effective_at timestamptz,billing_stopped_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE company_os_uninstall_receipts(receipt_id uuid PRIMARY KEY,tenant_id uuid,instance_id uuid,installation_id uuid,uninstall_request_id uuid,subscription_id uuid,nonce text,payload jsonb,signature text,accepted_at timestamptz DEFAULT now(),UNIQUE(tenant_id,instance_id,nonce));
    `);
    const adapter=db.adapters.createPg();holder.pool=new adapter.Pool() as unknown as import("pg").Pool;
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'thea-blueprint','Blueprint System Framer','Test agent','active')",[modelId]);
    await holder.pool.query("INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,$3,'published','{}','publisher-stage','proof-signature','https://packages.faivr.invalid/test.tar.gz',$4,4900,'price_test_thea','1.0.0',now())",[versionId,modelId,version,digest]);
    process.env.STRIPE_SECRET_KEY="sk_test_local";
  });
  afterEach(async()=>{vi.unstubAllGlobals();delete process.env.STRIPE_SECRET_KEY;await holder.pool.end();});

  it("runs checkout, entitlement, activation, archive, uninstall, period-end cancellation, and provider-confirmed stop in order",async()=>{
    const selected=await selectPackage(tenantId,modelId,versionId);
    expect(selected.state).toBe("checkout_pending");

    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"cs_test_thea",url:"https://checkout.stripe.test/thea"}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"sub_test_thea",cancel_at_period_end:true,current_period_end:1_800_000_000}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const checkout=await createCheckoutSession({priceId:"price_test_thea",installationId:selected.installationId,tenantId,successUrl:"https://company.test/success",cancelUrl:"https://company.test/cancel"});
    expect(checkout.url).toBe("https://checkout.stripe.test/thea");
    const checkoutSessionId=randomUUID();
    expect(await recordCheckout(selected.installationId,checkoutSessionId,"cs_test_thea")).toMatchObject({installation_state:"payment_pending"});
    expect(await markEntitled(selected.installationId,tenantId,"cs_test_thea","sub_test_thea")).toBe(true);

    const localAgentDefinitionId="company-os-local-thea";
    const activated=await acknowledgeInstall(tenantId,{installationId:selected.installationId,modelId,version,packageDigest:digest,localAgentDefinitionId,activationResult:"active",compatibilityVerified:true,publisherSignatureVerified:true,packageChecksPassed:true});
    expect(activated).toMatchObject({installation_state:"active",subscription_state:"active"});

    const archived=await archiveInstallation(tenantId,selected.installationId);
    expect(archived).toMatchObject({installation_state:"disabled",subscription_state:"active",billing_stopped_at:null});
    const afterLocalRestore=await installationForTenant(tenantId,selected.installationId);
    expect(afterLocalRestore).toMatchObject({installation_state:"disabled",subscription_state:"active"});

    const uninstallRequestId=randomUUID();
    const pending=await requestUninstall(tenantId,selected.installationId,uninstallRequestId,modelId,versionId);
    expect(pending).toMatchObject({installation_state:"uninstall_pending",subscription_state:"cancellation_pending_uninstall"});

    const receipt:UninstallReceipt={schemaVersion:"faivr-marketplace-lifecycle.v1",messageType:"package.uninstalled",requestId:randomUUID(),idempotencyKey:"uninstall-proof",tenantId,instanceId,installationId:selected.installationId,modelId,version,occurredAt:"2026-08-15T08:00:00.000Z",receiptId:randomUUID(),uninstallRequestId,subscriptionId:selected.subscriptionId,localAgentDefinitionId,packageDigest:digest,removedManagedPaths:[`agents/${modelId}/${version}`],result:"completed",verifiedEffects:{agentRegistrationAbsent:true,schedulesRevoked:true,toolGrantsRevoked:true,agentSecretsRevoked:true,packagePayloadRemoved:true,historicalCompanyDataPreserved:true},retainedData:{customerDataPurged:false,historicalCompanyData:"retained_read_only",backupDisposition:"retention_policy",userCopies:"not_verified",thirdPartyCopies:"not_verified"},completedAt:"2026-08-15T08:01:00.000Z",nonce:"receipt-nonce-thea",signature:{keyId:"company-os-proof",algorithm:"Ed25519",value:"proof"}};
    const accepted=await acceptUninstallReceipt(receipt,"proof");
    expect(accepted.state).toBe("receipt_accepted");
    const cancellation=await scheduleSubscriptionCancellation("sub_test_thea",`faivr-uninstall-${receipt.receiptId}`);
    expect(cancellation.cancel_at_period_end).toBe(true);
    const effectiveAt=new Date(1_800_000_000*1000).toISOString();
    await markCancellationPending(tenantId,selected.installationId,effectiveAt);
    expect(await installationForTenant(tenantId,selected.installationId)).toMatchObject({installation_state:"removed",subscription_state:"cancel_at_period_end",billing_stopped_at:null});
    expect(await confirmBillingStoppedByStripe("sub_test_thea",effectiveAt)).toBe(true);
    expect(await installationForTenant(tenantId,selected.installationId)).toMatchObject({installation_state:"removed",subscription_state:"cancelled"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records an abandoned checkout selection as failed after a provider error",async()=>{
    const selected=await selectPackage(tenantId,modelId,versionId);
    expect(await markCheckoutFailed(tenantId,selected.installationId)).toBe(true);
    expect(await installationForTenant(tenantId,selected.installationId)).toMatchObject({installation_state:"failed",subscription_state:"checkout_pending"});
  });

  it("binds the public V1 handlers to the ordered store and provider operations",()=>{
    const source=readFileSync(new URL("../app/api/company-os/v1/handlers.ts",import.meta.url),"utf8");
    for(const call of ["selectPackage(","createCheckoutSession(","markCheckoutFailed(","acknowledgeInstall(","archiveInstallation(","requestUninstall(","acceptUninstallReceipt(","scheduleSubscriptionCancellation(","markCancellationPending(","signBillingAcknowledgement("]){
      expect(source,`missing handler binding ${call}`).toContain(call);
    }
    const webhook=readFileSync(new URL("../app/api/company-os/stripe/webhook/route.ts",import.meta.url),"utf8");
    expect(webhook).toContain("confirmBillingStoppedByStripe(");
  });
});
