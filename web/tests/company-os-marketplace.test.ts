import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, canonicalRequest, canonicalSignedMessage, signCompanyOsRequest, verifyCompanyOsRequest, verifyMessageSignature, type RequestIdentity } from "@/lib/companyOs/auth";
import { COMPANY_OS_HEADERS, COMPANY_OS_V1_ENDPOINTS } from "@/lib/companyOs/contract";
import { archiveReceiptSchema, billingAcknowledgementSchema, installationStateSchema, isAcceptableUninstallReceipt, modelIdSchema, semverSchema, sha256Schema, subscriptionStateSchema, uninstallReceiptSchema, uuidSchema } from "@/lib/companyOs/schemas";
import { createCheckoutSession, scheduleSubscriptionCancellation, stripeApiOrigin } from "@/lib/companyOs/stripe";

const U={tenant:"11111111-1111-4111-8111-111111111111",instance:"22222222-2222-4222-8222-222222222222",installation:"33333333-3333-4333-8333-333333333333",subscription:"44444444-4444-4444-8444-444444444444",receipt:"55555555-5555-4555-8555-555555555555",request:"66666666-6666-4666-8666-666666666666",local:"77777777-7777-4777-8777-777777777777",event:"88888888-8888-4888-8888-888888888888"};
const identity:RequestIdentity={tenantId:U.tenant,instanceId:U.instance,keyId:"key-1",timestamp:"1000",nonce:"nonce-1",idempotencyKey:"idem-1"};
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const privatePem=privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicPem=publicKey.export({type:"spki",format:"pem"}).toString();
const envelope={schemaVersion:"faivr-marketplace-lifecycle.v1",requestId:U.request,idempotencyKey:"idem-1",tenantId:U.tenant,instanceId:U.instance,occurredAt:"2026-08-15T00:00:00.000Z"};
const retainedData={customerDataPurged:false,historicalCompanyData:"retained_read_only",backupDisposition:"retention_policy",userCopies:"not_verified",thirdPartyCopies:"not_verified"};
const effects={agentRegistrationAbsent:true,schedulesRevoked:true,toolGrantsRevoked:true,agentSecretsRevoked:true,packagePayloadRemoved:true,historicalCompanyDataPreserved:true};
const receipt={...envelope,messageType:"package.uninstalled",receiptId:U.receipt,uninstallRequestId:U.request,subscriptionId:U.subscription,installationId:U.installation,modelId:"faivr.agent.research-assistant",version:"1.2.3",localAgentDefinitionId:"agdef-research",packageDigest:`sha256:${"a".repeat(64)}`,removedManagedPaths:["agents/research-assistant"],result:"completed",verifiedEffects:effects,retainedData,completedAt:"2026-08-15T00:01:00.000Z",nonce:"receipt-nonce",signature:{keyId:"key-1",algorithm:"Ed25519",value:"placeholder"}} as const;

describe("locked request bytes",()=>{
  it("uses the exact eight-line canonical string",()=>expect(canonicalRequest(identity,"post","/api/company-os/v1/installations?a=1","{}")).toBe(`POST\n/api/company-os/v1/installations?a=1\n${"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}\n1000\nnonce-1\n${U.tenant}\n${U.instance}\nidem-1`));
  it("hashes an empty body as SHA-256 of zero bytes",()=>expect(canonicalRequest({...identity,idempotencyKey:""},"GET","/api/company-os/v1/catalog","").split("\n")[2]).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
  it("does not include contract version",()=>expect(canonicalRequest(identity,"GET","/x","")).not.toContain("faivr-marketplace"));
  it("does not include keyId",()=>expect(canonicalRequest(identity,"GET","/x","")).not.toContain("key-1"));
  it("binds the exact query",()=>expect(canonicalRequest(identity,"GET","/x?a=1","")).not.toBe(canonicalRequest(identity,"GET","/x?a=2","")));
  it("verifies its Ed25519 signature",()=>{const s=signCompanyOsRequest(privatePem,identity,"GET","/x","");expect(verifyCompanyOsRequest({publicKey:publicPem,identity,signature:s,method:"GET",exactPathAndQuery:"/x",body:"",now:1_000_000})).toBe(true);});
  it("rejects tampered bytes",()=>{const s=signCompanyOsRequest(privatePem,identity,"GET","/x","");expect(verifyCompanyOsRequest({publicKey:publicPem,identity,signature:s,method:"GET",exactPathAndQuery:"/y",body:"",now:1_000_000})).toBe(false);});
});

describe("RFC 8785 receipt signatures",()=>{
  it("sorts object keys recursively",()=>expect(canonicalJson({z:1,a:{y:2,x:3}})).toBe('{"a":{"x":3,"y":2},"z":1}'));
  it("canonicalizes negative zero",()=>expect(canonicalJson(-0)).toBe("0"));
  it("rejects non-finite numbers",()=>expect(()=>canonicalJson(Infinity)).toThrow());
  it("omits signature from signed bytes",()=>expect(canonicalSignedMessage({b:1,signature:{value:"x"},a:2})).toBe('{"a":2,"b":1}'));
  it("verifies a JCS receipt signature",()=>{const signed={...receipt,signature:{...receipt.signature,value:edSign(null,Buffer.from(canonicalSignedMessage(receipt)),privateKey).toString("base64url")}};expect(verifyMessageSignature(signed,publicPem)).toBe(true);});
});

describe("locked identifiers and state",()=>{
  it("accepts UUID identifiers",()=>expect(uuidSchema.safeParse(U.tenant).success).toBe(true));
  it("rejects non-UUID identifiers",()=>expect(uuidSchema.safeParse("tenant-a").success).toBe(false));
  it("accepts locked model ids only",()=>{expect(modelIdSchema.safeParse("faivr.agent.research-assistant").success).toBe(true);expect(modelIdSchema.safeParse("model-1").success).toBe(false);});
  it("accepts SemVer",()=>expect(semverSchema.safeParse("1.2.3-rc.1").success).toBe(true));
  it("requires the sha256 prefix",()=>{expect(sha256Schema.safeParse(`sha256:${"a".repeat(64)}`).success).toBe(true);expect(sha256Schema.safeParse("a".repeat(64)).success).toBe(false);});
  it("locks all installation states",()=>expect(installationStateSchema.options).toEqual(["selected","payment_pending","entitled","downloading","installing","active","update_available","disabled","uninstall_pending","removed","failed"]));
  it("locks all subscription states",()=>expect(subscriptionStateSchema.options).toEqual(["checkout_pending","active","past_due","suspended","cancellation_pending_uninstall","cancel_at_period_end","cancelled"]));
});

describe("locked receipts and billing",()=>{
  it("accepts the exact completed uninstall receipt",()=>expect(uninstallReceiptSchema.safeParse(receipt).success).toBe(true));
  it("parses partial receipts but never accepts them",()=>{const p=uninstallReceiptSchema.parse({...receipt,result:"partial"});expect(isAcceptableUninstallReceipt(p)).toBe(false);});
  it("rejects completed receipts with a false effect",()=>{const p=uninstallReceiptSchema.parse({...receipt,verifiedEffects:{...effects,schedulesRevoked:false}});expect(isAcceptableUninstallReceipt(p)).toBe(false);});
  it("requires removed managed paths",()=>expect(uninstallReceiptSchema.safeParse({...receipt,removedManagedPaths:[]}).success).toBe(false));
  it("requires retained user and third-party copy states",()=>{const {userCopies:_,...bad}=retainedData;expect(uninstallReceiptSchema.safeParse({...receipt,retainedData:bad}).success).toBe(false);});
  it("locks archive effects and retained data",()=>expect(archiveReceiptSchema.safeParse({...envelope,messageType:"agent.archived",receiptId:U.receipt,installationId:U.installation,modelId:"faivr.agent.research-assistant",version:"1.2.3",localAgentDefinitionId:"agdef-research",archiveState:"archived",billingEffect:"unchanged",archiveEffects:{newRunsBlocked:true,runtimeBindingDisabled:true,schedulesDisabled:true,toolGrantsDisabled:true,agentSecretsRevoked:true,packagePayloadRetained:true,historicalCompanyDataPreserved:true},retainedData,archivedAt:"2026-08-15T00:01:00.000Z",nonce:"n",signature:receipt.signature}).success).toBe(true));
  it("accepts exact billing acknowledgement states",()=>expect(billingAcknowledgementSchema.safeParse({...envelope,messageType:"billing.stop_acknowledged",installationId:U.installation,modelId:"faivr.agent.research-assistant",version:"1.2.3",eventId:U.event,receiptId:U.receipt,subscriptionId:U.subscription,receiptState:"accepted",subscriptionState:"cancel_at_period_end",effectiveAt:"2026-09-15T00:00:00.000Z",signature:receipt.signature}).success).toBe(true));
  it("distinguishes scheduled from stopped",()=>{expect(subscriptionStateSchema.safeParse("cancel_at_period_end").success).toBe(true);expect(subscriptionStateSchema.safeParse("cancelled").success).toBe(true);});
});

describe("actual V1 route files",()=>{
  for(const endpoint of COMPANY_OS_V1_ENDPOINTS) it(endpoint,()=>{const path=endpoint.split(" ")[1].replace("/api/company-os/v1/","").replace("{modelId}","[modelId]").replace("{id}","[id]");expect(existsSync(new URL(`../app/api/company-os/v1/${path}/route.ts`,import.meta.url))).toBe(true);});
  it("locks exact header spellings",()=>expect(Object.values(COMPANY_OS_HEADERS)).toEqual(["X-FAIVR-Tenant-Id","X-FAIVR-Instance-Id","X-FAIVR-Key-Id","X-FAIVR-Timestamp","X-FAIVR-Nonce","Idempotency-Key","X-FAIVR-Signature"]));
  it("persists installation and subscription state separately",()=>{const sql=readFileSync(new URL("../sql/company-os-marketplace.sql",import.meta.url),"utf8");expect(sql).toContain("installation_state text");expect(sql).toContain("subscription_state text");});
  it("stores internal checkout UUID separately from Stripe text identifiers",()=>{const sql=readFileSync(new URL("../sql/company-os-marketplace.sql",import.meta.url),"utf8");expect(sql).toContain("checkout_session_id uuid UNIQUE");expect(sql).toContain("stripe_checkout_session_id text UNIQUE");});
  it("allows empty GET idempotency but requires it for mutations",()=>{const source=readFileSync(new URL("../lib/companyOs/http.ts",import.meta.url),"utf8");expect(source).toContain('req.method !== "GET" && !identity.idempotencyKey');});
  it("contains no placeholder V1 handler responses",()=>expect(readFileSync(new URL("../app/api/company-os/v1/handlers.ts",import.meta.url),"utf8")).not.toContain('error:"not_configured"'));
  it("projects the publisher key id needed by the package verification headers",()=>expect(readFileSync(new URL("../lib/companyOs/store.ts",import.meta.url),"utf8")).toContain("v.publisher_key_id,v.publisher_signature"));
  it("allows activation after the real package route advances the state to downloading",()=>expect(readFileSync(new URL("../lib/companyOs/store.ts",import.meta.url),"utf8")).toContain("installation_state IN ('entitled','downloading','installing','active')"));
});

describe("Stripe provider behavior",()=>{
  afterEach(()=>{vi.unstubAllGlobals();delete process.env.STRIPE_SECRET_KEY;delete process.env.FAIVR_STRIPE_API_ORIGIN;delete process.env.FAIVR_STAGED_LOCAL_PROVIDERS;delete process.env.FAIVR_STAGED_PROVIDER_CA_PATH;});
  it("creates a hosted subscription checkout with scoped metadata",async()=>{process.env.STRIPE_SECRET_KEY="sk_test_local";const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"cs_test_1",url:"https://checkout.stripe.test/x"}),{status:200}));vi.stubGlobal("fetch",fetchMock);const result=await createCheckoutSession({priceId:"price_1",installationId:U.installation,tenantId:U.tenant,successUrl:"https://company.test/success",cancelUrl:"https://company.test/cancel"});expect(result.id).toBe("cs_test_1");const init=fetchMock.mock.calls[0][1] as RequestInit;expect(String(init.body)).toContain(`metadata%5Binstallation_id%5D=${U.installation}`);});
  it("requests cancellation only at period end with provider idempotency",async()=>{process.env.STRIPE_SECRET_KEY="sk_test_local";const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"sub_1",cancel_at_period_end:true}),{status:200}));vi.stubGlobal("fetch",fetchMock);await scheduleSubscriptionCancellation("sub_1","cancel-1");const init=fetchMock.mock.calls[0][1] as RequestInit;expect(String(init.body)).toBe("cancel_at_period_end=true");expect((init.headers as Record<string,string>)["Idempotency-Key"]).toBe("cancel-1");});
  it("does not call a provider when Stripe is unconfigured",async()=>{const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);await expect(scheduleSubscriptionCancellation("sub_1","cancel-1")).rejects.toThrow("stripe_not_configured");expect(fetchMock).not.toHaveBeenCalled();});
  it("allows an explicit TLS loopback origin only for staged non-production runs",()=>{process.env.FAIVR_STRIPE_API_ORIGIN="https://127.0.0.1:49443";process.env.FAIVR_STAGED_LOCAL_PROVIDERS="1";expect(stripeApiOrigin()).toBe("https://127.0.0.1:49443");});
  it("rejects staged provider overrides that are not TLS loopback",async()=>{process.env.STRIPE_SECRET_KEY="sk_stage_local";process.env.FAIVR_STRIPE_API_ORIGIN="https://stripe.example";process.env.FAIVR_STAGED_LOCAL_PROVIDERS="1";const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);await expect(scheduleSubscriptionCancellation("sub_stage","cancel-stage")).rejects.toThrow("stripe_provider_origin_not_allowed");expect(fetchMock).not.toHaveBeenCalled();});
});
