import type { NextRequest } from "next/server";
import { hasOperatorAuthConfig } from "@/lib/env";

export type OperatorAuthResult =
  | { ok: true; method: "basic" | "legacy-header"; actor: string }
  | { ok: false; reason: "missing-config" | "invalid" };

const LEGACY_OPERATOR_HEADER = "x-operator-key";

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.toLowerCase().startsWith("basic ")) return null;

  try {
    const decoded = atob(value.slice("basic ".length).trim());
    const splitAt = decoded.indexOf(":");
    if (splitAt === -1) return null;

    return {
      username: decoded.slice(0, splitAt),
      password: decoded.slice(splitAt + 1),
    };
  } catch {
    return null;
  }
}

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [aDigest, bDigest] = await Promise.all([digest(a), digest(b)]);
  let diff = a.length ^ b.length;

  for (let index = 0; index < aDigest.length; index += 1) {
    diff |= aDigest[index] ^ bDigest[index];
  }

  return diff === 0;
}

export async function authorizeOperatorRequest(req: NextRequest): Promise<OperatorAuthResult> {
  const username = process.env.OPERATOR_AUTH_USERNAME?.trim() ?? "";
  const password = process.env.OPERATOR_AUTH_PASSWORD?.trim() ?? "";
  const authHeader = req.headers.get("authorization");

  if (hasOperatorAuthConfig() && authHeader) {
    const parsed = decodeBasicAuth(authHeader);
    if (parsed) {
      const [usernameMatches, passwordMatches] = await Promise.all([
        timingSafeEqual(parsed.username, username),
        timingSafeEqual(parsed.password, password),
      ]);

      if (usernameMatches && passwordMatches) {
        return { ok: true, method: "basic", actor: username };
      }
    }
  }

  const legacyKey = process.env.QUOTE_REQUEST_OPERATOR_KEY?.trim() ?? "";
  const suppliedLegacyKey = req.headers.get(LEGACY_OPERATOR_HEADER)?.trim() ?? "";

  if (legacyKey && suppliedLegacyKey) {
    if (await timingSafeEqual(suppliedLegacyKey, legacyKey)) {
      return { ok: true, method: "legacy-header", actor: "legacy-operator-key" };
    }
  }

  if (!hasOperatorAuthConfig() && !legacyKey) {
    return { ok: false, reason: "missing-config" };
  }

  return { ok: false, reason: "invalid" };
}

export function operatorAuthChallengeHeaders(): HeadersInit {
  return {
    "WWW-Authenticate": 'Basic realm="FAIVR Operator", charset="UTF-8"',
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}
