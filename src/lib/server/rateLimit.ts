export type RateLimitOptions = {
  limit?: number;
  windowMs?: number;
};

export type RateLimitAllowed = {
  allowed: true;
  remaining: number;
};

export type RateLimitRejected = {
  allowed: false;
  status: 429;
  body: { error: string };
};

export type RateLimitResult = RateLimitAllowed | RateLimitRejected;

export type RateLimiter = {
  check: (tokenId: string, nowMs?: number) => RateLimitResult;
  reset: (tokenId?: string) => void;
};

export const DEFAULT_RATE_LIMIT = 60;
export const DEFAULT_RATE_WINDOW_MS = 60_000;

export function createRateLimiter(opts?: RateLimitOptions): RateLimiter {
  const limit =
    opts?.limit !== undefined &&
    Number.isInteger(opts.limit) &&
    opts.limit > 0
      ? opts.limit
      : DEFAULT_RATE_LIMIT;

  const windowMs =
    opts?.windowMs !== undefined &&
    Number.isFinite(opts.windowMs) &&
    opts.windowMs > 0
      ? opts.windowMs
      : DEFAULT_RATE_WINDOW_MS;

  const buckets = new Map<string, number[]>();

  return {
    check(tokenId: string, nowMs: number = Date.now()): RateLimitResult {
      const cutoff = nowMs - windowMs;
      const existing = buckets.get(tokenId) ?? [];
      const kept = existing.filter((ts) => ts > cutoff);
      const inWindowCount = kept.filter((ts) => ts <= nowMs).length;

      if (inWindowCount >= limit) {
        if (kept.length > 0) {
          buckets.set(tokenId, kept);
        } else {
          buckets.delete(tokenId);
        }
        return {
          allowed: false,
          status: 429,
          body: {
            error: 'Too many requests. Please wait a moment and try again.',
          },
        };
      }

      kept.push(nowMs);
      buckets.set(tokenId, kept);

      return {
        allowed: true,
        remaining: Math.max(0, limit - (inWindowCount + 1)),
      };
    },

    reset(tokenId?: string): void {
      if (tokenId === undefined) {
        buckets.clear();
      } else {
        buckets.delete(tokenId);
      }
    },
  };
}
