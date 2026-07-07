import { NextRequest, NextResponse } from "next/server";
import { authorizeOperatorRequest, operatorAuthChallengeHeaders } from "@/lib/operatorAuth";

function quoteRequestNeedsOperatorAuth(req: NextRequest): boolean {
  if (req.nextUrl.pathname !== "/api/quote-requests") return false;
  if (req.method === "PATCH") return true;
  if (req.method !== "GET") return false;

  return !req.nextUrl.searchParams.has("requesterAddress");
}

function isOperatorSurface(pathname: string): boolean {
  return pathname === "/operator" || pathname.startsWith("/operator/");
}

function isSupportAdminSurface(pathname: string): boolean {
  return pathname === "/support-admin" || pathname.startsWith("/support-admin/") || pathname.startsWith("/api/support/admin/");
}

function unauthorizedResponse(status = 401) {
  return new NextResponse(status === 503 ? "Operator auth is not configured" : "Unauthorized", {
    status,
    headers: operatorAuthChallengeHeaders(),
  });
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const protectedSurface = isOperatorSurface(pathname) || isSupportAdminSurface(pathname) || quoteRequestNeedsOperatorAuth(req);

  if (!protectedSurface) {
    return NextResponse.next();
  }

  const auth = await authorizeOperatorRequest(req);
  if (!auth.ok) {
    return unauthorizedResponse(auth.reason === "missing-config" ? 503 : 401);
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  matcher: ["/operator/:path*", "/support-admin/:path*", "/api/support/admin/:path*", "/api/quote-requests"],
};
