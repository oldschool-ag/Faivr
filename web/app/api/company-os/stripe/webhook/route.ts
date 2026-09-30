import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {getPgPool} from "@/lib/postgres";
import {confirmBillingStoppedByStripe,markEntitled} from "@/lib/companyOs/store";
import {activateBundleSubscription,markBundleSubscriptionState} from "@/lib/companyOs/privateStore";
import {validStripeSignature} from "@/lib/companyOs/stripe";

/**
 * Stripe is the only payment provider of the store. Events are verified with the webhook
 * secret, deduplicated by event id, and applied inside one transaction:
 *
 * - checkout.session.completed: a function-bundle checkout (metadata.bundle_subscription_id)
 *   activates the bundle subscription; a legacy per-installation checkout entitles the
 *   installation.
 * - customer.subscription.deleted, or updated with status canceled: billing stopped.
 * - customer.subscription.updated with status past_due / unpaid: the bundle is past due;
 *   back to active when Stripe reports active again.
 * - invoice.payment_failed: the bundle subscription is past due.
 */
export async function POST(req:NextRequest){
  const secret=process.env.STRIPE_WEBHOOK_SECRET?.trim();if(!secret)return NextResponse.json({error:"Webhook not configured"},{status:503});
  const body=await req.text();if(!validStripeSignature(body,req.headers.get("stripe-signature"),secret))return NextResponse.json({error:"Invalid signature"},{status:401});
  let event:{id?:unknown;type?:unknown;data?:{object?:Record<string,unknown>}};try{event=JSON.parse(body);}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  if(typeof event.id!=="string"||typeof event.type!=="string"||!event.data?.object)return NextResponse.json({error:"Invalid event"},{status:400});
  const pool=getPgPool();const client=await pool.connect();try{await client.query("BEGIN");const inserted=await client.query("INSERT INTO company_os_webhook_events(provider,event_id,payload) VALUES('stripe',$1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id",[event.id,body]);if(!inserted.rowCount){await client.query("COMMIT");return NextResponse.json({received:true,replayed:true});}
    const object=event.data.object;
    const metadata=(typeof object.metadata==="object"&&object.metadata?object.metadata:{}) as Record<string,unknown>;
    if(event.type==="checkout.session.completed"&&typeof object.id==="string"&&typeof object.subscription==="string"){
      if(typeof metadata.bundle_subscription_id==="string"){
        if(typeof metadata.tenant_id!=="string"||!await activateBundleSubscription({subscriptionId:metadata.bundle_subscription_id,tenantId:metadata.tenant_id,stripeCheckoutSessionId:object.id,stripeSubscriptionId:object.subscription},client))throw new Error("checkout_scope_mismatch");
      }else if(typeof metadata.installation_id!=="string"||typeof metadata.tenant_id!=="string"||!await markEntitled(metadata.installation_id,metadata.tenant_id,object.id,object.subscription,client))throw new Error("checkout_scope_mismatch");
    }
    if((event.type==="customer.subscription.deleted"||(event.type==="customer.subscription.updated"&&object.status==="canceled"))&&typeof object.id==="string"){
      const effective=typeof object.ended_at==="number"?new Date(object.ended_at*1000).toISOString():new Date().toISOString();
      const bundle=await markBundleSubscriptionState(object.id,"cancelled",effective,client);
      const installation=await confirmBillingStoppedByStripe(object.id,effective,client);
      if(!bundle&&!installation)throw new Error("subscription_scope_mismatch");
    }
    if(event.type==="customer.subscription.updated"&&(object.status==="past_due"||object.status==="unpaid")&&typeof object.id==="string"){await markBundleSubscriptionState(object.id,"past_due",null,client);}
    if(event.type==="customer.subscription.updated"&&object.status==="active"&&typeof object.id==="string"){await markBundleSubscriptionState(object.id,"active",null,client);}
    if(event.type==="invoice.payment_failed"&&typeof object.subscription==="string"){await markBundleSubscriptionState(object.subscription,"past_due",null,client);}
    await client.query("COMMIT");return NextResponse.json({received:true});
  }catch(error){await client.query("ROLLBACK");return NextResponse.json({error:error instanceof Error?error.message:"webhook_failed"},{status:409});}finally{client.release();}
}
