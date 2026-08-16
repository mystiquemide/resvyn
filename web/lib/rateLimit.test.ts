import { describe, it, expect, beforeEach } from "vitest"
import { checkClientLimit, consumeClaimBudget, consumeGlobalBudget, clientKeyFromRequest, claimKeyFromIds, resetRateLimiterForTests } from "./rateLimit"

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

describe("checkClientLimit (round 3/4 API)", () => {
  it("allows requests up to the default max of 100", () => {
    for (let i = 0; i < 100; i++) {
      expect(checkClientLimit(KEY + "-default").allowed).toBe(true)
    }
    expect(checkClientLimit(KEY + "-default").allowed).toBe(false)
  })

  it("blocks the request past the max with a retry window", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "10"
    for (let i = 0; i < 10; i++) checkClientLimit(KEY + "-block")
    const r = checkClientLimit(KEY + "-block")
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThan(0)
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it("isolates keys from each other", () => {
    for (let i = 0; i < 110; i++) checkClientLimit(KEY + "-a")
    expect(checkClientLimit(KEY + "-b").allowed).toBe(true)
  })

  it("honors a custom max from env", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "2"
    expect(checkClientLimit(KEY + "-max2").allowed).toBe(true)
    expect(checkClientLimit(KEY + "-max2").allowed).toBe(true)
    expect(checkClientLimit(KEY + "-max2").allowed).toBe(false)
  })

  // REV-005 round 2: without a trusted proxy there is NO shared per-client
  // bucket, so one caller cannot exhaust an "everyone" allowance.
  it("skips the per-client bucket for the untrusted shared identity", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "2" // would block a normal client at 3
    for (let i = 0; i < 20; i++) {
      expect(checkClientLimit("shared").allowed).toBe(true)
    }
  })
})

describe("consumeClaimBudget (REV-005 round 4)", () => {
  it("caps requests per claim regardless of client key", () => {
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "3"
    for (let i = 0; i < 3; i++) {
      expect(consumeClaimBudget("1:1").allowed).toBe(true)
    }
    expect(consumeClaimBudget("1:1").allowed).toBe(false)
    // A different claim still has its own budget.
    expect(consumeClaimBudget("2:2").allowed).toBe(true)
  })

  // REV-005 round 4: the claim budget is consumed ONLY after authentication,
  // so invalid signatures can never burn a known claim's allowance.
  it("is independent of the per-client bucket", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "1"
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "100"
    // A caller hammering with garbage signatures exhausts only its own
    // client bucket; the claim allowance stays intact for the real claimant.
    expect(checkClientLimit("attacker").allowed).toBe(true)
    expect(checkClientLimit("attacker").allowed).toBe(false)
    for (let i = 0; i < 50; i++) {
      expect(consumeClaimBudget("1:1").allowed).toBe(true)
    }
  })
})

describe("consumeGlobalBudget (REV-005 rounds 3/4)", () => {
  it("caps total traffic via the global budget", () => {
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "3"
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false)
  })

  // REV-005 round 3: the global budget is consumed ONLY at the signing point,
  // so an unauthenticated flood of syntactically valid requests with unique
  // claim ids cannot exhaust it (those requests never reach signing).
  it("is never touched by cheap per-client checks", () => {
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "2"
    // A flood of unique claims passes the cheap check without touching global.
    for (let i = 0; i < 50; i++) {
      expect(checkClientLimit("shared").allowed).toBe(true)
    }
    // The signing point still has its full allowance.
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false)
  })

  it("is not consumed by blocked claim-budget requests", () => {
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "1"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "3"
    expect(consumeClaimBudget("9:9").allowed).toBe(true)
    expect(consumeClaimBudget("9:9").allowed).toBe(false) // claim-blocked
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(true)
    expect(consumeGlobalBudget().allowed).toBe(false) // global exhausted at 3
  })

  // REV-005 round 5: buckets must not grow without bounds. Expired windows
  // are swept once the map exceeds MAX_BUCKETS, and an all-live pathological
  // map drops the oldest half.
  it("evicts expired buckets once the map grows past the cap", () => {
    process.env.RESVYN_RATE_LIMIT_MAX = "1" // every client gets one hit
    process.env.RESVYN_RATE_LIMIT_WINDOW_MS = "50" // then expires fast
    // Fill the map past MAX_BUCKETS with unique keys.
    for (let i = 0; i < 10_050; i++) {
      expect(checkClientLimit(`evict-${i}`).allowed).toBe(true)
    }
    // The first buckets are now long expired; the map must have been swept
    // (bounded size) and the same keys can be reused without error.
    expect(checkClientLimit("evict-0").allowed).toBe(true)
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
    expect(clientKeyFromRequest(req)).toBe("ip:1.2.3.4")
  })

  it("falls back to cf-connecting-ip behind a declared trusted proxy", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "cf-connecting-ip": "9.9.9.9" },
    })
    expect(clientKeyFromRequest(req)).toBe("ip:9.9.9.9")
  })

  it("falls back to the shared identity without proxy headers", () => {
    process.env.RESVYN_TRUST_PROXY = "1"
    expect(clientKeyFromRequest(new Request("http://localhost/api/evaluate"))).toBe("shared")
  })
})

describe("claimKeyFromIds (REV-005 round 2)", () => {
  it("builds a canonical per-claim key from parsed ids", () => {
    expect(claimKeyFromIds(1n, 2n)).toBe("1:2")
    // The route parses with BigInt before calling, so alternate spellings of
    // the same id collapse to one key.
    expect(claimKeyFromIds(BigInt("01"), BigInt("+1"))).toBe("1:1")
    expect(claimKeyFromIds(BigInt("0x1"), 1n)).toBe("1:1")
  })
})
