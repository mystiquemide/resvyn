/*
 * In-memory sliding-window rate limiter for /api/evaluate.
 *
 * The evaluator route signs decisions, so it is the one public endpoint that
 * must not be freely spammable. This is a single-instance limiter: it lives in
 * process memory, which is correct for the current one-server deployment.
 * A multi-instance deployment must move this to a shared store.
 *
 * Identity (REV-005): client-supplied forwarding headers are only trusted when
 * the deployment actually sits behind a proxy that strips and rewrites them
 * (RESVYN_TRUST_PROXY=1). Without that explicit acknowledgement the limiter
 * falls back to a single shared bucket, so a caller rotating arbitrary
 * x-forwarded-for values gains no advantage over honest clients.
 *
 * Budgets (REV-005): every request consumes a GLOBAL bucket and a per-claim
 * bucket, so one claim cannot be drained by many IPs and one caller cannot
 * burn the whole server budget. Memory is bounded: the map is swept on every
 * call and hard-capped, with eviction starting at the oldest activity.
 *
 * Config (server env, gitignored):
 *   RESVYN_RATE_LIMIT_MAX         max requests per window per client (default 10)
 *   RESVYN_RATE_LIMIT_WINDOW_MS   window length in ms (default 60000)
 *   RESVYN_RATE_LIMIT_GLOBAL_MAX  global max per window across all clients
 *                                 (default 200)
 *   RESVYN_RATE_LIMIT_CLAIM_MAX   max evaluate calls per claim per window
 *                                 (default 5)
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
  claimMax: 5,
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

function consume(key: string, now: number, budget: number): boolean {
  const cutoff = now - state.windowMs
  const times = (state.hits.get(key) ?? []).filter((t) => t > cutoff)
  if (times.length >= budget) return false
  times.push(now)
  state.hits.set(key, times)
  return true
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

export function checkRateLimit(
  clientKey: string,
  claimKey?: string,
): RateLimitResult {
  readConfig()
  const now = Date.now()
  sweep(now)
  evictOldest(now)

  // Global budget first: protects the whole server, independent of identity.
  if (!consume("__global__", now, state.globalMax)) {
    const times = state.hits.get("__global__") ?? []
    const retryAfterMs = Math.max(0, (times[0] ?? now) + state.windowMs - now)
    return { allowed: false, retryAfterMs, remaining: 0 }
  }

  // Per-claim budget: one claim cannot be drained by many identities.
  if (claimKey && !consume(claimKey, now, state.claimMax)) {
    const times = state.hits.get(claimKey) ?? []
    const retryAfterMs = Math.max(0, (times[0] ?? now) + state.windowMs - now)
    return { allowed: false, retryAfterMs, remaining: 0 }
  }

  // Per-client budget.
  if (!consume(clientKey, now, state.max)) {
    const times = state.hits.get(clientKey) ?? []
    const retryAfterMs = Math.max(0, (times[0] ?? now) + state.windowMs - now)
    return { allowed: false, retryAfterMs, remaining: 0 }
  }

  const remaining = state.max - (state.hits.get(clientKey)?.length ?? 0)
  return { allowed: true, retryAfterMs: 0, remaining }
}

/** Test-only: clear all tracked buckets. Never called by the route. */
export function resetRateLimiterForTests(): void {
  state.hits.clear()
}

/**
 * Client identity (REV-005). Forwarding headers are spoofable, so they are
 * used ONLY when the operator explicitly declared a trusted stripping proxy
 * (RESVYN_TRUST_PROXY=1). Otherwise every caller shares one bucket: spoofing
 * cannot bypass the cap, and honest clients get the same budget as attackers.
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

/** Per-claim budget key so evaluate traffic is capped per claim (REV-005). */
export function claimKeyFromIds(coverageId: bigint | string, claimId: bigint | string): string {
  return `claim:${String(coverageId)}:${String(claimId)}`
}
