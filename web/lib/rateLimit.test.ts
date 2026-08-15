import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { checkRateLimit, consumeGlobalBudget, clientKeyFromRequest, claimKeyFromIds, resetRateLimiterForTests } from "./rateLimit"

// The limiter keeps module-level state; tests reset it explicitly.
const KEY = "test-client"

beforeEach(() => {
  delete process.env.RESVYN_RATE_LIMIT_MAX
  delete process.env.RESVYN_RATE_LIMIT_WINDOW_MS
  delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
  delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
  delete process.env.RESVYN_TRUST_PROXY
  resetRateLimiterForTests()
})

afterEach(() => {
  delete process.env.RESVYN_RATE_LIMIT_MAX
  delete process.env.RESVYN_RATE_LIMIT_WINDOW_MS
  delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
  delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
  delete process.env.RESVYN_TRUST_PROXY
})

describe("checkRateLimit", () => {
  it("allows requests up to the default max of 10", () => {
    for (let i = 1; i <= 10; i++) {
      const r = checkRateLimit(KEY + "-default")
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(10 - i)
    }
  })

  it("blocks the request past the max with a retry window", () => {
    for (let i = 0; i < 10; i++) checkRateLimit(KEY + "-block")
    const r = checkRateLimit(KEY + "-block")
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
    expect(r.retryAfterMs).toBeGreaterThan(0)
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it("isolates keys from each other", () => {
    for (let i = 0; i < 12; i++) checkRateLimit(KEY + "-a")
    expect(checkRateLimit(KEY + "-b").allowed).toBe(true)
  })

  it("honors a custom max from env", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "2"
    expect(checkRateLimit(KEY + "-max2").allowed).toBe(true)
    expect(checkRateLimit(KEY + "-max2").allowed).toBe(true)
    expect(checkRateLimit(KEY + "-max2").allowed).toBe(false)
  })

  // REV-005: the per-claim budget caps evaluation traffic for one claim even
  // when many different client keys are used, so a distributed flood cannot
  // drain a single claim's signing quota.
  it("caps requests per claim regardless of client key", () => {
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "3"
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(`client-${i}`, "claim:1:1").allowed).toBe(true)
    }
    expect(checkRateLimit("client-4", "claim:1:1").allowed).toBe(false)
    // A different claim still has its own budget.
    expect(checkRateLimit("client-4", "claim:2:2").allowed).toBe(true)
  })

  // REV-005: the global budget protects the server even when a caller rotates
  // client identities. It is consumed at the signing point (consumeGlobalBudget).
  it("caps total traffic via the global budget", () => {
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "3"
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false)
  })

  // REV-005 round 2: an already-blocked client must NOT burn the global
  // budget for other clients, and a blocked claim must not burn it either.
  // (checkRateLimit never touches the global bucket at all; consumeGlobalBudget
  // is called separately at the signing point.)
  it("does not consume the global budget for requests blocked by client or claim limits", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "2"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "3"
    // Client A exhausts its own bucket after 2 hits.
    expect(checkRateLimit("blocked-a", "claim:9:9").allowed).toBe(true)
    expect(checkRateLimit("blocked-a", "claim:9:9").allowed).toBe(true)
    expect(checkRateLimit("blocked-a", "claim:9:9").allowed).toBe(false) // client-blocked
    // Client B still has its own allowance: checkRateLimit ignores global.
    expect(checkRateLimit("blocked-b", "claim:9:9").allowed).toBe(true)
    // The global budget is consumed only by consumeGlobalBudget, which the
    // routes call at the signing point.
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false) // global exhausted at 3
  })

  // REV-005 round 3: the global budget is consumed ONLY at the signing point,
  // so an unauthenticated flood of syntactically valid requests with unique
  // claim ids cannot exhaust it (those requests never reach signing).
  it("consumes the global budget only when explicitly called at signing", () => {
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "2"
    // A flood of unique claims passes the cheap check without touching global.
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit("shared", `claim:${i}:1`).allowed).toBe(true)
    }
    // The signing point still has its full allowance.
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false)
  })

  // REV-005 round 2: without a trusted proxy there is NO shared per-client
  // bucket, so one caller cannot exhaust an "everyone" allowance. Abuse stays
  // bounded by the per-claim and global budgets.
  it("skips the per-client bucket for the untrusted shared identity", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "2" // would block a normal client at 3
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "100"
    // 20 requests all using the shared identity with different claims all pass.
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit("shared", `claim:${i}:1`).allowed).toBe(true)
    }
    // No single caller can lock out everyone else by exhausting a shared key.
  })
})

describe("clientKeyFromRequest (REV-005)", () => {
  it("refuses to trust forwarding headers unless a trusted proxy is declared", () => {
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    // No RESVYN_TRUST_PROXY: spoofable headers are ignored and the identity
    // is "shared", which skips the per-client bucket entirely.
    expect(clientKeyFromRequest(req)).toBe("shared")
  })

  it("uses the first x-forwarded-for entry behind a declared trusted proxy", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    expect(clientKeyFromRequest(req)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip behind a declared trusted proxy", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-real-ip": "9.9.9.9" },
    })
    expect(clientKeyFromRequest(req)).toBe("9.9.9.9")
  })

  it("falls back to the shared identity without proxy headers", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    expect(clientKeyFromRequest(new Request("http://localhost/api/evaluate"))).toBe("shared")
  })
})

describe("claimKeyFromIds (REV-005 round 2)", () => {
  it("builds a canonical per-claim key from parsed ids", () => {
    expect(claimKeyFromIds(1n, 2n)).toBe("claim:1:2")
    // The route parses with BigInt before calling, so alternate spellings of
    // the same id collapse to one key.
    expect(claimKeyFromIds(BigInt("01"), BigInt("+1"))).toBe("claim:1:1")
    expect(claimKeyFromIds(BigInt("0x1"), 1n)).toBe("claim:1:1")
  })
})
