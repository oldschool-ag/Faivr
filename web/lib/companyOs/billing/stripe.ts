import { createHmac, timingSafeEqual } from "node:crypto";
import { requireStagedLoopbackUrl, stagedProviderRequest } from "../stagedProvider";
export function validStripeSignature(payload:string,header:string|null,secret:string,now=Date.now()){if(!header)return false;const fields=header.split(",").map(v=>v.trim().split("=",2));const timestamp=fields.find(([k])=>k==="t")?.[1];const signatures=fields.filter(([k])=>k==="v1").map(([,v])=>v);if(!timestamp||!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;const expected=Buffer.from(createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest("hex"),"hex");return signatures.some(value=>{if(!/^[a-f0-9]{64}$/i.test(value))return false;const supplied=Buffer.from(value,"hex");return supplied.length===expected.length&&timingSafeEqual(expected,supplied);});}

export function stripeApiOrigin() {
  const configured=process.env.FAIVR_STRIPE_API_ORIGIN?.trim();
  if(!configured)return "https://api.stripe.com";
  let origin:URL;
  try{origin=new URL(configured);}catch{throw new Error("stripe_provider_origin_not_allowed");}
  try{requireStagedLoopbackUrl(origin);}catch{throw new Error("stripe_provider_origin_not_allowed");}
  if(origin.pathname!=="/"||origin.search)throw new Error("stripe_provider_origin_not_allowed");
  return origin.origin;
}

async function stagedStripeRequest(url:string,init:RequestInit):Promise<{ok:boolean;value:Record<string,unknown>}> {
  const body=init.body instanceof URLSearchParams?init.body.toString():typeof init.body==="string"?init.body:"";
  const response=await stagedProviderRequest({url:new URL(url),method:init.method,headers:init.headers as Record<string,string>|undefined,body});
  return {ok:response.status>=200&&response.status<300,value:JSON.parse(response.body.toString("utf8")) as Record<string,unknown>};
}

async function stripeRequest(path:string, init:RequestInit={}) {
  const key=process.env.STRIPE_SECRET_KEY?.trim();
  if(!key) throw new Error("stripe_not_configured");
  const origin=stripeApiOrigin();
  const requestInit={...init,headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/x-www-form-urlencoded",...(init.headers||{})}};
  let ok:boolean,value:Record<string,unknown>;
  if(origin==="https://api.stripe.com"){
    const response=await fetch(`${origin}/v1/${path}`,requestInit);
    ok=response.ok;value=await response.json() as Record<string,unknown>;
  }else{
    ({ok,value}=await stagedStripeRequest(`${origin}/v1/${path}`,requestInit));
  }
  if(!ok) throw new Error(typeof value.error==="object"&&value.error&&"message" in value.error?String((value.error as {message:unknown}).message):"stripe_provider_error");
  return value;
}
export async function createCheckoutSession(input:{priceId:string;installationId:string;tenantId:string;successUrl:string;cancelUrl:string;bundleSubscriptionId?:string}){
  const body=new URLSearchParams({mode:"subscription",success_url:input.successUrl,cancel_url:input.cancelUrl,"line_items[0][price]":input.priceId,"line_items[0][quantity]":"1","metadata[installation_id]":input.installationId,"metadata[tenant_id]":input.tenantId,"subscription_data[metadata][installation_id]":input.installationId,"subscription_data[metadata][tenant_id]":input.tenantId});
  // T6b: a function-bundle checkout; the webhook activates the bundle subscription, not one installation
  if(input.bundleSubscriptionId){body.set("metadata[bundle_subscription_id]",input.bundleSubscriptionId);body.set("subscription_data[metadata][bundle_subscription_id]",input.bundleSubscriptionId);}
  return stripeRequest("checkout/sessions",{method:"POST",body});
}
export async function retrieveCheckoutSession(id:string){return stripeRequest(`checkout/sessions/${encodeURIComponent(id)}`);}
export async function scheduleSubscriptionCancellation(id:string,idempotencyKey:string){
  return stripeRequest(`subscriptions/${encodeURIComponent(id)}`,{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:new URLSearchParams({cancel_at_period_end:"true"})});
}

// --- T6b.1: the Stripe implementation of the billing-provider interface ------------------------
// The functions above are the T6b code, moved here unchanged; the adapter below puts them behind
// the interface so the store's state machine never sees a provider.

import { stripeConfig } from "./config";
import {
  BillingWebhookPayloadError,
  BillingWebhookSignatureError,
  isoOrNull,
  stringOrNull,
  type BillingBundle,
  type BillingEvent,
  type BillingProvider,
  type BillingSubscriptionState,
  type CreateCheckoutInput,
  type ProviderSubscription,
} from "./provider";

export function stripeSubscriptionState(status: unknown, cancelAtPeriodEnd: unknown): BillingSubscriptionState {
  switch (status) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd === true ? "cancel_at_period_end" : "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "checkout_pending";
  }
}

export async function retrieveSubscription(id: string) {
  return stripeRequest(`subscriptions/${encodeURIComponent(id)}`);
}

export async function createBillingPortalSession(customerId: string, returnUrl: string | null) {
  const body = new URLSearchParams({ customer: customerId });
  if (returnUrl) body.set("return_url", returnUrl);
  return stripeRequest("billing_portal/sessions", { method: "POST", body });
}

function stripeEventView(event: { id: string; type: string; data: { object: Record<string, unknown> } }): BillingEvent {
  const object = event.data.object;
  const metadata = (typeof object.metadata === "object" && object.metadata ? object.metadata : {}) as Record<string, unknown>;
  const base = { provider: "stripe" as const, eventId: event.id, type: event.type, providerCustomerId: stringOrNull(object.customer), instanceId: null, bundleId: null, legacyInstallationId: null };
  const empty = { ...base, kind: "ignored" as const, providerSubscriptionId: null, providerCheckoutId: null, subscriptionId: null, tenantId: null, state: null, periodEnd: null };
  if (event.type === "checkout.session.completed" && typeof object.id === "string" && typeof object.subscription === "string") {
    const bundleSubscriptionId = stringOrNull(metadata.bundle_subscription_id);
    return { ...base, kind: "checkout_completed", providerCheckoutId: object.id, providerSubscriptionId: object.subscription, subscriptionId: bundleSubscriptionId, tenantId: stringOrNull(metadata.tenant_id), legacyInstallationId: bundleSubscriptionId ? null : stringOrNull(metadata.installation_id), state: "active", periodEnd: null };
  }
  if (typeof object.id !== "string") return empty;
  if (event.type === "customer.subscription.deleted" || (event.type === "customer.subscription.updated" && object.status === "canceled")) {
    return { ...base, kind: "subscription_ended", providerSubscriptionId: object.id, providerCheckoutId: null, subscriptionId: null, tenantId: null, state: "cancelled", periodEnd: isoOrNull(object.ended_at) ?? new Date().toISOString() };
  }
  if (event.type === "customer.subscription.updated" && (object.status === "past_due" || object.status === "unpaid")) {
    return { ...base, kind: "subscription_past_due", providerSubscriptionId: object.id, providerCheckoutId: null, subscriptionId: null, tenantId: null, state: "past_due", periodEnd: null };
  }
  if (event.type === "customer.subscription.updated" && object.status === "active") {
    return { ...base, kind: "subscription_active", providerSubscriptionId: object.id, providerCheckoutId: null, subscriptionId: null, tenantId: null, state: "active", periodEnd: isoOrNull(object.current_period_end) };
  }
  if (event.type === "invoice.payment_failed" && typeof object.subscription === "string") {
    return { ...base, kind: "subscription_past_due", providerSubscriptionId: object.subscription, providerCheckoutId: null, subscriptionId: null, tenantId: null, state: "past_due", periodEnd: null };
  }
  return empty;
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe" as const;
  private readonly webhookSecret: string;

  constructor(config?: { webhookSecret: string }) {
    this.webhookSecret = (config ?? stripeConfig()).webhookSecret;
  }

  productReference(bundle: BillingBundle) {
    return bundle.stripePriceId ? { reference: bundle.stripePriceId } : { error: "stripe_price_not_configured" };
  }

  async createCheckout(input: CreateCheckoutInput) {
    const reference = this.productReference(input.bundle);
    if ("error" in reference) throw new Error(reference.error);
    const provider = await createCheckoutSession({ priceId: reference.reference, installationId: input.subscriptionId, tenantId: input.tenantId, successUrl: input.successUrl, cancelUrl: input.cancelUrl, bundleSubscriptionId: input.subscriptionId });
    if (typeof provider.id !== "string" || typeof provider.url !== "string") throw new Error("stripe_invalid_response");
    return { checkoutId: provider.id, url: provider.url };
  }

  async readSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const value = await retrieveSubscription(providerSubscriptionId);
    return {
      providerSubscriptionId,
      providerCustomerId: stringOrNull(value.customer),
      state: stripeSubscriptionState(value.status, value.cancel_at_period_end),
      currentPeriodEnd: isoOrNull(value.current_period_end),
      cancelAtPeriodEnd: value.cancel_at_period_end === true,
      endedAt: isoOrNull(value.ended_at),
    };
  }

  async cancelAtPeriodEnd(providerSubscriptionId: string, idempotencyKey: string) {
    const provider = await scheduleSubscriptionCancellation(providerSubscriptionId, idempotencyKey);
    return { effectiveAt: isoOrNull(provider.current_period_end) ?? new Date().toISOString() };
  }

  async parseWebhook(input: { body: string; headers: Headers }): Promise<BillingEvent> {
    if (!validStripeSignature(input.body, input.headers.get("stripe-signature"), this.webhookSecret)) throw new BillingWebhookSignatureError("stripe_webhook_signature_invalid");
    let event: { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(input.body);
    } catch {
      throw new BillingWebhookPayloadError("stripe_webhook_invalid_json");
    }
    if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) throw new BillingWebhookPayloadError("stripe_webhook_invalid_event");
    return stripeEventView({ id: event.id, type: event.type, data: { object: event.data.object } });
  }

  async customerPortalUrl(input: { ownerAccountId: string; providerCustomerId: string | null; returnUrl: string | null }) {
    if (!input.providerCustomerId) return null;
    const session = await createBillingPortalSession(input.providerCustomerId, input.returnUrl);
    if (typeof session.url !== "string") throw new Error("stripe_invalid_response");
    return { url: session.url, expiresAt: null };
  }
}
