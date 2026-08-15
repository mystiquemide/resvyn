import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { checkRateLimit, clientKeyFromRequest, claimKeyFromIds, resetRateLimiterForTests } from "./rateLimit"

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
  // client identities.
  it("caps total traffic across all client keys", () => {
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "3"
    expect(checkRateLimit("a-1").allowed).toBe(true)
    expect(checkRateLimit("a-2").allowed).toBe(true)
    expect(checkRateLimit("a-3").allowed).toBe(true)
    expect(checkRateLimit("a-4").allowed).toBe(false)
  })
})

describe("clientKeyFromRequest (REV-005)", () => {
  it("refuses to trust forwarding headers unless a trusted proxy is declared", () => {
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    // No RESVYN_TRUST_PROXY: spoofable headers are ignored, everyone shares
    // the same bucket, so rotating header values buys nothing.
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

  it("falls back to the shared bucket without proxy headers", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    expect(clientKeyFromRequest(new Request("http://localhost/api/evaluate"))).toBe("shared")
  })
})

describe("claimKeyFromIds", () => {
  it("builds a stable per-claim key", () => {
    expect(claimKeyFromIds(1n, 2n)).toBe("claim:1:2")
    expect(claimKeyFromIds("1", "2")).toBe("claim:1:2")
  })
})
