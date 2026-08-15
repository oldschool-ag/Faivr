import { NextResponse } from "next/server";
export function legacyGone(){return NextResponse.json({error:"legacy_endpoint_gone",use:"/api/company-os/v1"},{status:410});}
