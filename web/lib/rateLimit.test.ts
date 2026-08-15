import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { checkRateLimit, clientKeyFromRequest } from "./rateLimit"

// The limiter keeps module-level state; reset it by re-importing is not
// possible, so tests use distinct client keys per test.
const KEY = "test-client"

beforeEach(() => {
  delete process.env.RESVYN_RATE_LIMIT_MAX
  delete process.env.RESVYN_RATE_LIMIT_WINDOW_MS
})

afterEach(() => {
  delete process.env.RESVYN_RATE_LIMIT_MAX
  delete process.env.RESVYN_RATE_LIMIT_WINDOW_MS
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
})

describe("clientKeyFromRequest", () => {
  it("uses the first x-forwarded-for entry", () => {
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    expect(clientKeyFromRequest(req)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip", () => {
    const req = new Request("http://localhost/api/evaluate", {
      headers: { "x-real-ip": "9.9.9.9" },
    })
    expect(clientKeyFromRequest(req)).toBe("9.9.9.9")
  })

  it("falls back to local", () => {
    expect(clientKeyFromRequest(new Request("http://localhost/api/evaluate"))).toBe("local")
  })
})
