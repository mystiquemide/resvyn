// Throwaway verification for web/lib/groqBrain.ts. Run with node --experimental-strip-types.
// Covers: hard-signal gate (no API call), fallback on bad key, fallback on timeout,
// schema validity of every returned decision, and the no-key path.
import assert from "node:assert/strict"
import { groqBrain, isGroqConfigured } from "./web/lib/groqBrain.ts"
import { ModelDecisionSchema } from "./web/lib/evaluator.server.ts"

const BASE_EVIDENCE = {
  productMatches: true,
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  issuedAt: 1755000000n,
  requestedAmount: 1000000000000000n,
  evidenceHash: ("0x" + "11".repeat(32)) as `0x${string}`,
}
const CTX = {
  maxPayout: 2000000000000000n,
  asOf: 1755003600n,
  stalenessWindow: 2592000n,
  seenEvidenceHashes: new Set<string>(),
  modelVersion: "resvyn-eval-v1",
}

// 1) Hard-signal gate: a failing signal must REJECT deterministically without any API call.
delete process.env.RESVYN_GROQ_KEY
assert.equal(isGroqConfigured(), false)
const bad = await groqBrain({ ...BASE_EVIDENCE, fileIntegrityOk: false }, CTX)
assert.equal(bad.decision, "REJECT")
assert.equal(bad.reasonCode, "CORRUPTED_FILE")
console.log("PASS hard-signal gate (CORRUPTED_FILE, no API call)")

const overCap = await groqBrain({ ...BASE_EVIDENCE, requestedAmount: 9000000000000000n }, CTX)
assert.equal(overCap.decision, "REJECT")
assert.equal(overCap.reasonCode, "AMOUNT_EXCEEDS_CAP")
console.log("PASS hard-signal gate (AMOUNT_EXCEEDS_CAP)")

// 2) Bad key + all signals clean -> Groq 401 -> fallback to policy APPROVE (safe default).
process.env.RESVYN_GROQ_KEY = "gsk_bogus00000000000000000000000000000000"
assert.equal(isGroqConfigured(), true)
const t0 = Date.now()
const fallback = await groqBrain(BASE_EVIDENCE, CTX)
console.log(`PASS bad-key fallback -> ${fallback.decision} ${fallback.reasonCode} (${Date.now() - t0}ms)`)
assert.equal(fallback.decision, "APPROVE")
assert.equal(fallback.approvedAmount, BASE_EVIDENCE.requestedAmount.toString())

// 3) Every returned decision must be schema-valid.
for (const d of [bad, overCap, fallback]) {
  assert.equal(ModelDecisionSchema.safeParse(d).success, true)
}
console.log("PASS all decisions schema-valid")

// 4) Timeout fallback: unreachable endpoint + tiny timeout -> policy APPROVE.
process.env.RESVYN_GROQ_TIMEOUT_MS = "300"
const saved = globalThis.fetch
// @ts-expect-error test override
globalThis.fetch = (url: string | URL | Request, init?: RequestInit) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error("forced abort")), 50))
const timeoutCase = await groqBrain(BASE_EVIDENCE, CTX)
assert.equal(timeoutCase.decision, "APPROVE")
globalThis.fetch = saved
console.log("PASS forced-failure fallback -> policy APPROVE")

// 5) LIVE Groq call: run only when RESVYN_GROQ_KEY_LIVE is provided.
const liveKey = process.env.RESVYN_GROQ_KEY_LIVE
if (liveKey) {
  process.env.RESVYN_GROQ_KEY = liveKey
  const live = await groqBrain(
    { ...BASE_EVIDENCE, notes: "receipt photo is slightly blurry but readable", receiptText: "Synthetic warranty receipt for verification" },
    CTX,
  )
  console.log(`LIVE Groq decision: ${live.decision} ${live.reasonCode} amount=${live.approvedAmount} band=${live.confidenceBand} version=${live.modelVersion}`)
  assert.equal(live.decision, "APPROVE")
  assert.equal(live.reasonCode, "ELIGIBLE_DAMAGE_VERIFIED")
  assert.equal(ModelDecisionSchema.safeParse(live).success, true)
  assert.ok(BigInt(live.approvedAmount) <= BASE_EVIDENCE.requestedAmount)
  assert.equal(live.modelVersion, "resvyn-groq-openai/gpt-oss-120b")
  console.log("PASS live Groq call: real decision, schema-valid, clamped, server-owned version")
} else {
  console.log("SKIP live Groq call (no RESVYN_GROQ_KEY_LIVE)")
}

console.log("ALL GROQ BRAIN CHECKS PASSED")
