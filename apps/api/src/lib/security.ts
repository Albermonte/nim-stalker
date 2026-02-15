const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT_PER_WINDOW = 300;
const DEFAULT_MAIN_ORIGIN_LIMIT_PER_WINDOW = 100_000;
const DEFAULT_MAIN_ORIGIN_HOSTS = [
  'localhost',
  '127.0.0.1',
  'nimstalker.com',
  'www.nimstalker.com',
];

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

interface RateBucket {
  count: number;
  resetAtMs: number;
}

class FixedWindowRateLimiter {
  private buckets = new Map<string, RateBucket>();

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAtMs) {
      const resetAtMs = now + windowMs;
      this.buckets.set(key, { count: 1, resetAtMs });
      this.cleanup(now);
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - 1),
        resetAtMs,
        retryAfterSeconds: 0,
      };
    }

    if (bucket.count >= limit) {
      const retryAfterMs = Math.max(0, bucket.resetAtMs - now);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAtMs: bucket.resetAtMs,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAtMs: bucket.resetAtMs,
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.buckets.clear();
  }

  private cleanup(now: number): void {
    if (this.buckets.size < 5_000) return;
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAtMs) {
        this.buckets.delete(key);
      }
    }
  }
}

const sensitiveLimiter = new FixedWindowRateLimiter();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMainOriginHosts(): string[] {
  const configured = process.env.MAIN_ORIGIN_HOSTS;
  if (!configured) return DEFAULT_MAIN_ORIGIN_HOSTS;
  const hosts = configured
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : DEFAULT_MAIN_ORIGIN_HOSTS;
}

function parseHostFromHeader(headers: Headers): string | null {
  const raw = headers.get('origin') ?? headers.get('referer');
  if (!raw) return null;

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  return 'unknown';
}

function setRateLimitHeaders(
  set: { headers?: Record<string, string> },
  result: RateLimitResult,
): void {
  if (!set.headers) {
    set.headers = {};
  }

  set.headers['x-ratelimit-limit'] = String(result.limit);
  set.headers['x-ratelimit-remaining'] = String(result.remaining);
  set.headers['x-ratelimit-reset'] = String(Math.floor(result.resetAtMs / 1000));
}

export function isMainOriginRequest(headers: Headers): boolean {
  const host = parseHostFromHeader(headers);
  if (!host) return false;

  const mainHosts = parseMainOriginHosts();
  return mainHosts.some((mainHost) => host === mainHost || host.endsWith(`.${mainHost}`));
}

export function enforceSensitiveEndpointPolicy(
  request: Request,
  set: { status?: number; headers?: Record<string, string> },
  routeKey: string,
): { error: string; retryAfterSeconds?: number } | null {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return null;

  const headers = request.headers;
  const fromMainOrigin = isMainOriginRequest(headers);

  const windowMs = parsePositiveInt(
    process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS,
    DEFAULT_WINDOW_MS,
  );
  const defaultLimit = parsePositiveInt(
    process.env.SENSITIVE_RATE_LIMIT_PER_WINDOW,
    DEFAULT_LIMIT_PER_WINDOW,
  );
  const mainOriginLimit = parsePositiveInt(
    process.env.SENSITIVE_RATE_LIMIT_MAIN_ORIGIN_PER_WINDOW,
    DEFAULT_MAIN_ORIGIN_LIMIT_PER_WINDOW,
  );
  const limit = fromMainOrigin ? mainOriginLimit : defaultLimit;

  const clientIp = getClientIp(headers);
  const rateResult = sensitiveLimiter.check(`${routeKey}:${clientIp}`, limit, windowMs);
  setRateLimitHeaders(set, rateResult);

  if (!rateResult.allowed) {
    set.status = 429;
    if (!set.headers) {
      set.headers = {};
    }
    set.headers['retry-after'] = String(rateResult.retryAfterSeconds);
    return {
      error: 'Too Many Requests',
      retryAfterSeconds: rateResult.retryAfterSeconds,
    };
  }

  if (fromMainOrigin) return null;

  const expectedApiKey = process.env.API_KEY;
  const providedApiKey = headers.get('x-api-key');
  if (!expectedApiKey || !providedApiKey || providedApiKey !== expectedApiKey) {
    set.status = 401;
    return { error: 'Unauthorized' };
  }

  return null;
}

export function _resetSensitiveRateLimiter(): void {
  sensitiveLimiter.reset();
}
