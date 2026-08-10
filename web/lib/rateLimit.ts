import type { NextRequest } from "next/server";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

declare global {
  var __faivrRateLimits: Map<string, RateLimitEntry> | undefined;
}

function getStore(): Map<string, RateLimitEntry> {
  if (!globalThis.__faivrRateLimits) {
    globalThis.__faivrRateLimits = new Map();
  }

  return globalThis.__faivrRateLimits;
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function checkRateLimit(req: NextRequest, scope: string, options: RateLimitOptions): RateLimitResult {
  const store = getStore();
  const now = Date.now();
  const key = `${scope}:${getClientIp(req)}`;

  store.forEach((entry, entryKey) => {
    if (entry.resetAt <= now) {
      store.delete(entryKey);
    }
  });

  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return {
      allowed: true,
      remaining: options.limit - 1,
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: options.limit - current.count,
    retryAfterSeconds: 0,
  };
}

export function resetRateLimitForTests() {
  globalThis.__faivrRateLimits = new Map();
}
