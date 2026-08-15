/*
 * In-memory sliding-window rate limiter for /api/evaluate and /api/evidence.
 *
 * The evaluator routes sign decisions, so they must not be freely spammable.
 * This is a single-instance limiter: it lives in process memory, which is
 * correct for the current one-server deployment. A multi-instance deployment
 * must move this to a shared store.
 *
 * Identity (REV-005): client-supplied forwarding headers are only trusted when
 * the deployment actually sits behind a proxy that strips and rewrites them
 * (RESVYN_TRUST_PROXY=1). Without that explicit acknowledgement the per-client
 * bucket is SKIPPED entirely: there is no shared "everyone" bucket that a
 * single caller could exhaust, and abuse is bounded by the per-claim and
 * global budgets instead. Rotating arbitrary x-forwarded-for values gains
 * nothing.
 *
 * Budgets (REV-005 round 3):
 *  - checkRateLimit(): per-client (trusted proxy only) + per-claim budgets.
 *    Cheap; called early on every request. Never consumes the global budget.
 *  - consumeGlobalBudget(): the GLOBAL signing allowance. Called ONLY when a
 *    request is about to do the expensive/authoritative thing (write an
 *    evidence record, or sign a decision). An unauthenticated caller flooding
 *    syntactically valid requests with unique claim ids cannot exhaust the
 *    global budget for legitimate users, because those requests never reach
 *    the global consumption point (no record, no signature).
 * Budgets are checked BEFORE anything is consumed, so an already-blocked
 * request never burns another client's allowance. Memory is bounded: the map
 * is swept on every call and hard-capped, with eviction at oldest activity.
 *
 * Config (server env, gitignored):
 *   RESVYN_RATE_LIMIT_MAX         max requests per window per client (default 10)
 *   RESVYN_RATE_LIMIT_WINDOW_MS   window length in ms (default 60000)
 *   RESVYN_RATE_LIMIT_GLOBAL_MAX  global max per window across all clients
 *                                 (default 200)
 *   RESVYN_RATE_LIMIT_CLAIM_MAX   max calls per claim per window (default 10)
 *   RESVYN_RATE_LIMIT_MAX_KEYS    hard cap on tracked keys (default 5000)
 *   RESVYN_TRUST_PROXY            set to "1" only behind a stripping proxy
 */

interface LimiterState {
  max: number
  windowMs: number
  globalMax: number
  claimMax: number
  maxKeys: number
  hits: Map<string, number[]>
}

const state: LimiterState = {
  max: 10,
  windowMs: 60_000,
  globalMax: 200,
  claimMax: 10,
  maxKeys: 5_000,
  hits: new Map(),
}

function readConfig(): void {
  const int = (name: string): number | null => {
    const v = Number(process.env[name])
    return Number.isInteger(v) && v > 0 ? v : null
  }
  state.max = int("RESVYN_RATE_LIMIT_MAX") ?? state.max
  state.windowMs = int("RESVYN_RATE_LIMIT_WINDOW_MS") ?? state.windowMs
  state.globalMax = int("RESVYN_RATE_LIMIT_GLOBAL_MAX") ?? state.globalMax
  state.claimMax = int("RESVYN_RATE_LIMIT_CLAIM_MAX") ?? state.claimMax
  state.maxKeys = int("RESVYN_RATE_LIMIT_MAX_KEYS") ?? state.maxKeys
}

// Drop entries whose window has fully passed. Runs on every call so memory
// stays proportional to live traffic, not to total history.
function sweep(now: number): void {
  const cutoff = now - state.windowMs
  for (const [key, times] of state.hits) {
    const alive = times.filter((t) => t > cutoff)
    if (alive.length === 0) state.hits.delete(key)
    else if (alive.length !== times.length) state.hits.set(key, alive)
  }
}

// Hard cap: when the key map is full, evict the oldest-activity keys so a
// flood of unique keys cannot grow memory without bound (REV-005).
function evictOldest(now: number): void {
  while (state.hits.size >= state.maxKeys) {
    let oldestKey: string | null = null
    let oldestTs = Infinity
    for (const [key, times] of state.hits) {
      const last = times[times.length - 1] ?? 0
      if (last < oldestTs) {
        oldestTs = last
        oldestKey = key
      }
    }
    if (oldestKey === null) break
    state.hits.delete(oldestKey)
  }
}

function liveCount(key: string, now: number): number {
  const cutoff = now - state.windowMs
  return (state.hits.get(key) ?? []).filter((t) => t > cutoff).length
}

function recordHit(key: string, now: number): void {
  const cutoff = now - state.windowMs
  const times = (state.hits.get(key) ?? []).filter((t) => t > cutoff)
  times.push(now)
  state.hits.set(key, times)
}

function blocked(key: string, now: number): RateLimitResult {
  const times = state.hits.get(key) ?? []
  const retryAfterMs = Math.max(0, (times[0] ?? now) + state.windowMs - now)
  return { allowed: false, retryAfterMs, remaining: 0 }
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

/**
 * Per-client (trusted proxy only) + per-claim budgets. Cheap, early gate.
 * Does NOT consume or check the global budget (see consumeGlobalBudget).
 */
export function checkRateLimit(
  clientKey: string,
  claimKey?: string,
): RateLimitResult {
  readConfig()
  const now = Date.now()
  sweep(now)
  evictOldest(now)

  const keys: Array<[string, number]> = []
  if (clientKey !== "shared") keys.push([clientKey, state.max])
  if (claimKey) keys.push([claimKey, state.claimMax])

  for (const [key, budget] of keys) {
    if (liveCount(key, now) >= budget) return blocked(key, now)
  }
  for (const [key] of keys) recordHit(key, now)

  const remaining = clientKey === "shared"
    ? state.claimMax - (claimKey ? liveCount(claimKey, now) : 0)
    : state.max - liveCount(clientKey, now)
  return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, remaining) }
}

/**
 * Global signing allowance. Call ONLY right before the authoritative action
 * (storing an evidence record / signing a decision). This prevents an
 * unauthenticated flood of valid-looking requests from exhausting the global
 * budget for legitimate users (REV-005 round 3).
 */
export function consumeGlobalBudget(): RateLimitResult {
  readConfig()
  const now = Date.now()
  sweep(now)
  evictOldest(now)

  const key = "__global__"
  if (liveCount(key, now) >= state.globalMax) return blocked(key, now)
  recordHit(key, now)
  return { allowed: true, retryAfterMs: 0, remaining: state.globalMax - liveCount(key, now) }
}

/** Test-only: clear all tracked buckets. Never called by a route. */
export function resetRateLimiterForTests(): void {
  state.hits.clear()
}

/**
 * Client identity (REV-005). Forwarding headers are spoofable, so they are
 * used ONLY when the operator explicitly declared a trusted stripping proxy
 * (RESVYN_TRUST_PROXY=1). Otherwise the identity is "shared", which SKIPS the
 * per-client bucket entirely: there is no shared allowance for one caller to
 * exhaust, and abuse stays bounded by per-claim + global budgets.
 */
export function clientKeyFromRequest(req: Request): string {
  if (process.env.RESVYN_TRUST_PROXY !== "1") return "shared"
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "shared"
}

/**
 * Per-claim budget key. The route passes the CANONICAL decimal ids (parsed
 * with BigInt before rate limiting), so "1", "01", and "+1" all map to the
 * same key (REV-005 round 2).
 */
export function claimKeyFromIds(coverageId: bigint | string, claimId: bigint | string): string {
  return `claim:${String(coverageId)}:${String(claimId)}`
}
