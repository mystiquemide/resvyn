/*
 * In-memory sliding-window rate limiter for /api/evaluate and /api/evidence.
 *
 * The evaluator routes sign decisions, so they must not be freely spammable.
 * This is a single-instance limiter: multi-instance deployments must share
 * the same rate limit (e.g. one instance behind the load balancer, or a
 * shared store).
 *
 * ROUND 3/4 BUDGET DESIGN (three separate budgets):
 *   - checkClientLimit()      called EARLY (cheap, per-client). Without a
 *                             trusted proxy every caller maps to the shared
 *                             identity and this bucket is SKIPPED, so one
 *                             caller can never exhaust an "everyone"
 *                             allowance.
 *   - consumeClaimBudget()    called AFTER authentication/authorization, so
 *                             invalid signatures can never burn a known
 *                             claim's allowance (REV-005 round 4: per-claim
 *                             limits are not anonymously exhaustible).
 *   - consumeGlobalBudget()   called at the signing/write point only, so a
 *                             flood of cheap requests can never exhaust the
 *                             global allowance for legitimate users
 *                             (REV-005 round 3).
 *
 * Every check returns { allowed } and, when blocked, how long to wait
 * (retryAfterMs). Checks never record anything for a blocked request.
 */

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

export function resetRateLimiterForTests(): void {
  buckets.clear()
}

function readConfig(): { max: number; windowMs: number; globalMax: number; claimMax: number } {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v)
    return Number.isFinite(x) && x > 0 ? x : d
  }
  return {
    max: n(process.env.RESVYN_RATE_LIMIT_MAX, 100),
    windowMs: n(process.env.RESVYN_RATE_LIMIT_WINDOW_MS, 60_000),
    globalMax: n(process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX, 300),
    claimMax: n(process.env.RESVYN_RATE_LIMIT_CLAIM_MAX, 50),
  }
}

function now(): number {
  return Date.now()
}

function hit(key: string, max: number, windowMs: number): RateLimitResult {
  const t = now()
  const b = buckets.get(key)
  if (!b || t - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: t })
    return { allowed: true }
  }
  if (b.count >= max) {
    return { allowed: false, retryAfterMs: b.windowStart + windowMs - t }
  }
  b.count += 1
  return { allowed: true }
}

/**
 * Early, cheap per-client check. REV-005 round 2: when the request identity
 * is the untrusted shared bucket (no RESVYN_TRUST_PROXY), this is SKIPPED so
 * an attacker cannot exhaust an allowance shared by everyone.
 */
export function checkClientLimit(clientKey: string): RateLimitResult {
  const cfg = readConfig()
  if (clientKey === "shared") {
    return { allowed: true }
  }
  return hit(`client:${clientKey}`, cfg.max, cfg.windowMs)
}

/**
 * Per-claim budget. ROUND 4: callers MUST call this only AFTER
 * authentication/authorization succeeded, so invalid signatures cannot burn
 * a known claim's allowance.
 */
export function consumeClaimBudget(claimKey: string): RateLimitResult {
  const cfg = readConfig()
  return hit(`claim:${claimKey}`, cfg.claimMax, cfg.windowMs)
}

/**
 * Global budget consumed only at the signing/write point. A flood of cheap
 * or invalid requests never reaches it.
 */
export function consumeGlobalBudget(): RateLimitResult {
  const cfg = readConfig()
  return hit("global", cfg.globalMax, cfg.windowMs)
}

/** Unauthenticated callers share one identity unless a proxy is trusted. */
export function clientKeyFromRequest(req: Request): string {
  if (process.env.RESVYN_TRUST_PROXY !== "1") {
    return "shared"
  }
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) {
    return `ip:${fwd.split(",")[0]!.trim()}`
  }
  const cf = req.headers.get("cf-connecting-ip")
  if (cf) {
    return `ip:${cf.trim()}`
  }
  return "shared"
}

/**
 * Canonical per-claim key. Both routes parse ids with BigInt BEFORE calling
 * this, so "1", "01", and "+1" all map to the same key.
 */
export function claimKeyFromIds(coverageId: string | bigint, claimId: string | bigint): string {
  const c = typeof coverageId === "bigint" ? coverageId : BigInt(coverageId)
  const k = typeof claimId === "bigint" ? claimId : BigInt(claimId)
  return `${c.toString()}:${k.toString()}`
}
