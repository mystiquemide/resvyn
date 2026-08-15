import { describe, it, expect } from "vitest"
import { privateKeyToAccount } from "viem/accounts"
import { parseEther } from "viem"

// REV-010 parity test: the web evaluator (web/lib/evaluator.server.ts) is a
// port of the scripts evaluator (scripts/evaluator/*). The contract-critical
// logic - schema, policy, EIP-712 binding, and signing - must produce
// byte-identical decisions from both adapters, or rehearsal and production
// would drift. This test signs the same fixtures through both and compares
// the exact decision fields and the resulting signature.

// .js specifier resolves to the scripts TS source (NodeNext ESM style).
import { evaluateAndSign as scriptsEvaluateAndSign } from "../../scripts/evaluator/service.js"
import { evaluateAndSign as webEvaluateAndSign } from "./evaluator.server"

const SIGNER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
const account = privateKeyToAccount(SIGNER_KEY)

const VERIFIER = "0x414592d2313d233b673b1f97803c261355ccd996" as `0x${string}`
const CLAIMANT = "0xAbf039f2DC31084F5E0713708C96068126a043e9" as `0x${string}`
const EVIDENCE_HASH = ("0x" + "11".repeat(32)) as `0x${string}`

const fixture = {
  chainId: 677n,
  verifier: VERIFIER,
  claimId: 1n,
  coverageId: 1n,
  claimant: CLAIMANT,
  evidenceHash: EVIDENCE_HASH,
  nonce: 1n,
  maxPayout: parseEther("0.001"),
  asOf: 1755003600n,
  decisionTtl: 3600n,
}

const goodEvidence = {
  productMatches: true,
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  issuedAt: 1755000000n,
  requestedAmount: parseEther("0.0005"),
  evidenceHash: EVIDENCE_HASH,
}

function binding(overrides: Record<string, unknown> = {}) {
  return { ...fixture, ...overrides }
}

describe("evaluator parity scripts vs web (REV-010)", () => {
  it("produces the identical signed decision for an approval fixture", async () => {
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(goodEvidence, binding(), account),
      webEvaluateAndSign(goodEvidence, binding(), account),
    ])

    expect(script.model).toEqual(web.model)
    expect(script.decision).toEqual(web.decision)
    // Same key, same EIP-712 type hash, same domain, same message: the
    // signature must be byte-identical, proving the web port did not drift.
    expect(script.signature).toBe(web.signature)
    expect(script.signer).toBe(web.signer)
  })

  it("produces identical decisions for a rejection fixture", async () => {
    const rejected = { ...goodEvidence, damageEligible: false }
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(rejected, binding(), account),
      webEvaluateAndSign(rejected, binding(), account),
    ])
    expect(script.decision).toEqual(web.decision)
    expect(script.signature).toBe(web.signature)
    expect(script.model.decision).toBe("REJECT")
  })

  it("agrees at the cap boundary (approval exactly at maxPayout)", async () => {
    const atCap = { ...goodEvidence, requestedAmount: parseEther("0.001") }
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(atCap, binding(), account),
      webEvaluateAndSign(atCap, binding(), account),
    ])
    expect(script.decision.amount).toBe(web.decision.amount)
    expect(script.decision.amount).toBe(parseEther("0.001"))
    expect(script.signature).toBe(web.signature)
  })

  it("both agree on an over-cap request (policy REJECT, amount 0)", async () => {
    const overCap = { ...goodEvidence, requestedAmount: parseEther("0.002") }
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(overCap, binding(), account),
      webEvaluateAndSign(overCap, binding(), account),
    ])
    expect(web.model).toEqual(script.model)
    expect(web.model.decision).toBe("REJECT")
    expect(web.model.reasonCode).toBe("AMOUNT_EXCEEDS_CAP")
    expect(web.decision.amount).toBe(0n)
    expect(web.signature).toBe(script.signature)
  })

  it("both encode the same model version hash and decision expiry", async () => {
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(goodEvidence, binding(), account),
      webEvaluateAndSign(goodEvidence, binding(), account),
    ])
    expect(web.decision.modelVersion).toBe(script.decision.modelVersion)
    expect(web.decision.expiry).toBe(script.decision.expiry)
    expect(web.decision.expiry).toBe(fixture.asOf + fixture.decisionTtl)
  })

  it("both refuse a mismatched evidence hash", async () => {
    const wrongHash = { ...goodEvidence, evidenceHash: ("0x" + "22".repeat(32)) as `0x${string}` }
    await expect(scriptsEvaluateAndSign(wrongHash, binding(), account)).rejects.toThrow(/does not match/)
    await expect(webEvaluateAndSign(wrongHash, binding(), account)).rejects.toThrow(/does not match/)
  })
})
