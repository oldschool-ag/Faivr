import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {getPgPool} from "@/lib/postgres";
import {confirmBillingStoppedByStripe,markEntitled} from "@/lib/companyOs/store";
import {validStripeSignature} from "@/lib/companyOs/stripe";

export async function POST(req:NextRequest){
  const secret=process.env.STRIPE_WEBHOOK_SECRET?.trim();if(!secret)return NextResponse.json({error:"Webhook not configured"},{status:503});
  const body=await req.text();if(!validStripeSignature(body,req.headers.get("stripe-signature"),secret))return NextResponse.json({error:"Invalid signature"},{status:401});
  let event:{id?:unknown;type?:unknown;data?:{object?:Record<string,unknown>}};try{event=JSON.parse(body);}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  if(typeof event.id!=="string"||typeof event.type!=="string"||!event.data?.object)return NextResponse.json({error:"Invalid event"},{status:400});
  const pool=getPgPool();const client=await pool.connect();try{await client.query("BEGIN");const inserted=await client.query("INSERT INTO company_os_webhook_events(provider,event_id,payload) VALUES('stripe',$1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id",[event.id,body]);if(!inserted.rowCount){await client.query("COMMIT");return NextResponse.json({received:true,replayed:true});}
    const object=event.data.object;
    if(event.type==="checkout.session.completed"&&typeof object.id==="string"&&typeof object.subscription==="string"&&typeof object.metadata==="object"&&object.metadata){const metadata=object.metadata as Record<string,unknown>;if(typeof metadata.installation_id!=="string"||typeof metadata.tenant_id!=="string"||!await markEntitled(metadata.installation_id,metadata.tenant_id,object.id,object.subscription,client))throw new Error("checkout_scope_mismatch");}
    if((event.type==="customer.subscription.deleted"||(event.type==="customer.subscription.updated"&&object.status==="canceled"))&&typeof object.id==="string"){const effective=typeof object.ended_at==="number"?new Date(object.ended_at*1000).toISOString():new Date().toISOString();if(!await confirmBillingStoppedByStripe(object.id,effective,client))throw new Error("subscription_scope_mismatch");}
    await client.query("COMMIT");return NextResponse.json({received:true});
  }catch(error){await client.query("ROLLBACK");return NextResponse.json({error:error instanceof Error?error.message:"webhook_failed"},{status:409});}finally{client.release();}
}
