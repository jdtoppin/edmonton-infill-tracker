const attempts = new Map<string, { count: number; resetAt: number }>();

export function requestOriginIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  if (process.env.NODE_ENV === "production") {
    const configuredUrl = process.env.APP_URL;
    if (!configuredUrl) return false;
    try {
      return origin === new URL(configuredUrl).origin;
    } catch {
      return false;
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  if (!host) return false;

  return origin === `${protocol}://${host}`;
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count <= limit) return { allowed: true, retryAfter: 0 };

  return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
}
