/*
 * In-memory sliding-window rate limiter for /api/evaluate.
 *
 * The evaluator route signs decisions, so it is the one public endpoint that
 * must not be freely spammable. This is a single-instance limiter: it lives in
 * process memory, which is correct for the current one-server deployment.
 * A multi-instance deployment must move this to a shared store.
 *
 * Config (server env, gitignored):
 *   RESVYN_RATE_LIMIT_MAX         max requests per window per client (default 10)
 *   RESVYN_RATE_LIMIT_WINDOW_MS   window length in ms (default 60000)
 */

interface LimiterState {
  max: number
  windowMs: number
  hits: Map<string, number[]>
}

const state: LimiterState = {
  max: 10,
  windowMs: 60_000,
  hits: new Map(),
}

function readConfig(): void {
  const max = Number(process.env.RESVYN_RATE_LIMIT_MAX)
  if (Number.isInteger(max) && max > 0) state.max = max
  const windowMs = Number(process.env.RESVYN_RATE_LIMIT_WINDOW_MS)
  if (Number.isInteger(windowMs) && windowMs > 0) state.windowMs = windowMs
}

function sweep(now: number): void {
  if (state.hits.size < 10_000) return
  const cutoff = now - state.windowMs
  for (const [key, times] of state.hits) {
    const alive = times.filter((t) => t > cutoff)
    if (alive.length === 0) state.hits.delete(key)
    else state.hits.set(key, alive)
  }
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

export function checkRateLimit(clientKey: string): RateLimitResult {
  readConfig()
  const now = Date.now()
  const cutoff = now - state.windowMs
  sweep(now)

  const times = (state.hits.get(clientKey) ?? []).filter((t) => t > cutoff)
  if (times.length >= state.max) {
    const retryAfterMs = Math.max(0, times[0] + state.windowMs - now)
    return { allowed: false, retryAfterMs, remaining: 0 }
  }
  times.push(now)
  state.hits.set(clientKey, times)
  return { allowed: true, retryAfterMs: 0, remaining: state.max - times.length }
}

/** Best-effort client identity from proxy headers, falling back to the socket. */
export function clientKeyFromRequest(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) {
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "local"
}
