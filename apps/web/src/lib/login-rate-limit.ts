const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Attempt = { failures: number; windowStartedAt: number; blockedUntil: number };
const attempts = new Map<string, Attempt>();

export function loginClientKey(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function loginBlockSeconds(key: string, now = Date.now()) {
  const attempt = attempts.get(key);
  if (!attempt) return 0;
  if (attempt.blockedUntil > now) return Math.ceil((attempt.blockedUntil - now) / 1000);
  if (now - attempt.windowStartedAt >= WINDOW_MS) attempts.delete(key);
  return 0;
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const current = attempts.get(key);
  const attempt = !current || now - current.windowStartedAt >= WINDOW_MS
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    : current;
  attempt.failures += 1;
  if (attempt.failures >= MAX_FAILURES) attempt.blockedUntil = now + WINDOW_MS;
  attempts.set(key, attempt);
  return loginBlockSeconds(key, now);
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}

export function resetLoginRateLimitsForTest() {
  attempts.clear();
}
