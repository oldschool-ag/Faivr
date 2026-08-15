import { createHmac, timingSafeEqual } from "node:crypto";
import { requireStagedLoopbackUrl, stagedProviderRequest } from "./stagedProvider";
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
export async function createCheckoutSession(input:{priceId:string;installationId:string;tenantId:string;successUrl:string;cancelUrl:string}){
  const body=new URLSearchParams({mode:"subscription",success_url:input.successUrl,cancel_url:input.cancelUrl,"line_items[0][price]":input.priceId,"line_items[0][quantity]":"1","metadata[installation_id]":input.installationId,"metadata[tenant_id]":input.tenantId,"subscription_data[metadata][installation_id]":input.installationId,"subscription_data[metadata][tenant_id]":input.tenantId});
  return stripeRequest("checkout/sessions",{method:"POST",body});
}
export async function retrieveCheckoutSession(id:string){return stripeRequest(`checkout/sessions/${encodeURIComponent(id)}`);}
export async function scheduleSubscriptionCancellation(id:string,idempotencyKey:string){
  return stripeRequest(`subscriptions/${encodeURIComponent(id)}`,{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:new URLSearchParams({cancel_at_period_end:"true"})});
}
