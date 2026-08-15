import { NextResponse } from "next/server";
export function POST(){return NextResponse.json({error:"legacy_endpoint_gone",use:"/api/company-os/v1/checkout-sessions"},{status:410});}
