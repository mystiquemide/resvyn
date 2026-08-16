import { describe, it, expect, afterEach } from "vitest"
import { groqBrain, isGroqConfigured, GroqProviderError } from "./groqBrain"
import { ModelDecisionSchema, type ClaimEvidence, type PolicyContext } from "./evaluator.server"

const BASE_EVIDENCE: ClaimEvidence = {
  productMatches: true,
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  issuedAt: 1755000000n,
  requestedAmount: 1000000000000000n,
  evidenceHash: ("0x" + "11".repeat(32)) as `0x${string}`,
}

const CTX: PolicyContext = {
  maxPayout: 2000000000000000n,
  asOf: 1755003600n,
  stalenessWindow: 2592000n,
  seenEvidenceHashes: new Set<string>(),
  modelVersion: "resvyn-eval-v1",
}

afterEach(() => {
  delete process.env.RESVYN_GROQ_KEY
  delete process.env.RESVYN_GROQ_MODEL
  delete process.env.RESVYN_GROQ_TIMEOUT_MS
})

describe("hard-signal gate", () => {
  it("rejects corrupted files without calling the API", async () => {
    const d = await groqBrain({ ...BASE_EVIDENCE, fileIntegrityOk: false }, CTX)
    expect(d.decision).toBe("REJECT")
    expect(d.reasonCode).toBe("CORRUPTED_FILE")
  })

  it("rejects over-cap amounts without calling the API", async () => {
    const d = await groqBrain({ ...BASE_EVIDENCE, requestedAmount: 9000000000000000n }, CTX)
    expect(d.decision).toBe("REJECT")
    expect(d.reasonCode).toBe("AMOUNT_EXCEEDS_CAP")
  })

  it("rejects mismatched product evidence without calling the API", async () => {
    const d = await groqBrain({ ...BASE_EVIDENCE, productMatches: false }, CTX)
    expect(d.decision).toBe("REJECT")
    expect(d.reasonCode).toBe("PRODUCT_MISMATCH")
  })

  it("is not configured without a key", () => {
    expect(isGroqConfigured()).toBe(false)
  })
})

describe("Groq failure fails closed (REV-006)", () => {
  it("refuses to sign when the API returns 401", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 })) as typeof fetch
    try {
      await expect(groqBrain(BASE_EVIDENCE, CTX)).rejects.toThrow(GroqProviderError)
    } finally {
      globalThis.fetch = orig
    }
  })

  it("refuses to sign when the provider call rejects", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as typeof fetch
    try {
      await expect(groqBrain(BASE_EVIDENCE, CTX)).rejects.toThrow(GroqProviderError)
    } finally {
      globalThis.fetch = orig
    }
  })

  it("refuses to sign when Groq returns malformed JSON", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json at all" } }] }),
        { status: 200 },
      )) as typeof fetch
    try {
      await expect(groqBrain(BASE_EVIDENCE, CTX)).rejects.toThrow(GroqProviderError)
    } finally {
      globalThis.fetch = orig
    }
  })

  it("refuses to sign when Groq output fails the schema gate", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "REJECT",
                  approvedAmount: "123", // schema-invalid: REJECT must carry 0
                  reasonCode: "POLICY_UNCERTAIN",
                  confidenceBand: "LOW",
                  modelVersion: "resvyn-groq-openai/gpt-oss-120b",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch
    try {
      await expect(groqBrain(BASE_EVIDENCE, CTX)).rejects.toThrow(GroqProviderError)
    } finally {
      globalThis.fetch = orig
    }
  })

  it("clamps a schema-valid Groq approval to the requested amount", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "APPROVE",
                  approvedAmount: "9999999999999999999", // way over cap and request
                  reasonCode: "ELIGIBLE_DAMAGE_VERIFIED",
                  confidenceBand: "HIGH",
                  modelVersion: "resvyn-groq-openai/gpt-oss-120b",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch
    try {
      const d = await groqBrain(BASE_EVIDENCE, CTX)
      expect(d.decision).toBe("APPROVE")
      expect(d.approvedAmount).toBe(BASE_EVIDENCE.requestedAmount.toString())
      expect(d.modelVersion).toBe("resvyn-groq-openai/gpt-oss-120b")
      expect(ModelDecisionSchema.safeParse(d).success).toBe(true)
    } finally {
      globalThis.fetch = orig
    }
  })

  it("passes a schema-valid Groq REJECT through with approvedAmount 0", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "REJECT",
                  approvedAmount: "0",
                  reasonCode: "POLICY_UNCERTAIN",
                  confidenceBand: "LOW",
                  modelVersion: "resvyn-groq-openai/gpt-oss-120b",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch
    try {
      const d = await groqBrain(BASE_EVIDENCE, CTX)
      expect(d.decision).toBe("REJECT")
      expect(d.approvedAmount).toBe("0")
      expect(d.reasonCode).toBe("POLICY_UNCERTAIN")
      expect(d.modelVersion).toBe("resvyn-groq-openai/gpt-oss-120b")
      expect(ModelDecisionSchema.safeParse(d).success).toBe(true)
    } finally {
      globalThis.fetch = orig
    }
  })
})
