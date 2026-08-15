import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { privateKeyToAccount } from "viem/accounts"
import { keccak256, stringToHex } from "viem"

// Route integration tests for POST /api/evaluate (REV-001, REV-011).
//
// The route reads LIVE chain state, so the viem public client is mocked to a
// deterministic fixture (one open claim #1 on coverage #1 with a known
// evidence hash). Everything else - schema parsing, EIP-191 attestation
// recovery, evaluator policy, EIP-712 signing - runs for real.

const CLAIMANT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const MERCHANT_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
const EVALUATOR_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
const UNRELATED_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"

const TEST_CONTRACT = "0x1111111111111111111111111111111111111111" as `0x${string}`
const EVIDENCE_HASH = keccak256(stringToHex("damage-photos-and-receipt"))

const claimant = privateKeyToAccount(CLAIMANT_KEY)
const merchant = privateKeyToAccount(MERCHANT_KEY)
const evaluator = privateKeyToAccount(EVALUATOR_KEY)

// --- Mocks ----------------------------------------------------------------

vi.mock("@/lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chain")>()
  return {
    ...actual,
    APP_CHAIN: actual.botMainnet,
    APP_CONTRACT_ADDRESS: TEST_CONTRACT,
  }
})

const fakeClient = {
  readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "coverageOf":
        return {
          merchant: merchant.address,
          claimant: claimant.address,
          maxPayout: 1000000000000000n, // 0.001 BOT
          expiry: 2000000000n,
          status: 1,
        }
      case "claimOf":
        return {
          coverageId: 1n,
          claimant: claimant.address,
          evidenceHash: EVIDENCE_HASH,
          paidAmount: 0n,
          status: 1, // Open
          openedAt: 1755000000n,
        }
      case "isNonceUsed":
        return false
      default:
        throw new Error(`unexpected read: ${functionName}`)
    }
  }),
}

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => fakeClient,
  }
})

// --- Helpers --------------------------------------------------------------

function attestationBody(overrides: Record<string, unknown> = {}) {
  const timestamp = Math.floor(Date.now() / 1000)
  return {
    coverageId: "1",
    claimId: "1",
    evidence: {
      productMatches: true,
      damageEligible: true,
      evidenceComplete: true,
      fileIntegrityOk: true,
      requestedAmountWei: "500000000000000",
      issuedAt: timestamp - 3600,
    },
    timestamp,
    ...overrides,
  }
}

async function signedBody(signer: ReturnType<typeof privateKeyToAccount>, overrides: Record<string, unknown> = {}) {
  const base = attestationBody(overrides)
  const message = [
    "resvyn:evaluate",
    "677",
    TEST_CONTRACT,
    base.coverageId,
    base.claimId,
    EVIDENCE_HASH,
    base.evidence.productMatches ? "1" : "0",
    base.evidence.damageEligible ? "1" : "0",
    base.evidence.evidenceComplete ? "1" : "0",
    base.evidence.fileIntegrityOk ? "1" : "0",
    base.evidence.requestedAmountWei,
    String(base.evidence.issuedAt),
    String(base.timestamp),
  ].join(":")
  const signature = await signer.signMessage({ message })
  return { ...base, signer: signer.address, signature }
}

async function post(body: unknown): Promise<Response> {
  // Invoke the route handler directly with a synthetic Request instead of
  // hitting a network socket.
  const { POST } = await import("./route")
  return POST(new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

// --- Tests ----------------------------------------------------------------

describe("POST /api/evaluate trust boundary (REV-001)", () => {
  beforeAll(() => {
    process.env.RESVYN_EVALUATOR_KEY = EVALUATOR_KEY
    delete process.env.RESVYN_GROQ_KEY
    // The route rate-limits per shared bucket (no trusted proxy in tests);
    // raise the budgets so the test suite exercises auth, not throttling.
    process.env.RESVYN_RATE_LIMIT_MAX = "1000"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "10000"
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "10000"
  })

  afterAll(() => {
    delete process.env.RESVYN_EVALUATOR_KEY
    delete process.env.RESVYN_GROQ_KEY
    delete process.env.RESVYN_RATE_LIMIT_MAX
    delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
    delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
  })

  it("returns 400 for a request without an attestation signature", async () => {
    const res = await post(attestationBody())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("bad_request")
  })

  it("refuses an attestation signed by a key that owns neither claim nor coverage", async () => {
    const unrelated = privateKeyToAccount(UNRELATED_KEY)
    const res = await post(await signedBody(unrelated))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("attestation_invalid")
    expect(body.message).toMatch(/neither the claim claimant nor the coverage merchant/)
  })

  it("refuses when the signed evidence fields differ from the request body", async () => {
    // Signed with productMatches=true, sent with productMatches=false: the
    // recovered signer no longer matches the message the server rebuilds, so
    // the signature check must fail even though the key is the claimant's.
    const base = attestationBody()
    const message = [
      "resvyn:evaluate",
      "677",
      TEST_CONTRACT,
      base.coverageId,
      base.claimId,
      EVIDENCE_HASH,
      "1", // signed as true
      base.evidence.damageEligible ? "1" : "0",
      base.evidence.evidenceComplete ? "1" : "0",
      base.evidence.fileIntegrityOk ? "1" : "0",
      base.evidence.requestedAmountWei,
      String(base.evidence.issuedAt),
      String(base.timestamp),
    ].join(":")
    const signature = await claimant.signMessage({ message })
    const res = await post({
      ...base,
      signer: claimant.address,
      signature,
      evidence: { ...base.evidence, productMatches: false },
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("attestation_invalid")
  })

  it("refuses an attestation whose evidence hash does not match the on-chain claim", async () => {
    const otherHash = keccak256(stringToHex("different-evidence"))
    const base = attestationBody()
    const message = [
      "resvyn:evaluate",
      "677",
      TEST_CONTRACT,
      base.coverageId,
      base.claimId,
      otherHash,
      base.evidence.productMatches ? "1" : "0",
      base.evidence.damageEligible ? "1" : "0",
      base.evidence.evidenceComplete ? "1" : "0",
      base.evidence.fileIntegrityOk ? "1" : "0",
      base.evidence.requestedAmountWei,
      String(base.evidence.issuedAt),
      String(base.timestamp),
    ].join(":")
    const signature = await claimant.signMessage({ message })
    const res = await post({
      ...base,
      signer: claimant.address,
      signature,
      evidence: { ...base.evidence, evidenceHash: otherHash },
    })
    // The server rebuilds the attestation with the ON-CHAIN evidence hash, so
    // the signed message no longer recovers the claimant: refused either way.
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("attestation_invalid")
  })

  it("refuses a stale attestation (timestamp older than 5 minutes)", async () => {
    const old = Math.floor(Date.now() / 1000) - 3600
    const base = attestationBody({ timestamp: old })
    const message = [
      "resvyn:evaluate",
      "677",
      TEST_CONTRACT,
      base.coverageId,
      base.claimId,
      EVIDENCE_HASH,
      base.evidence.productMatches ? "1" : "0",
      base.evidence.damageEligible ? "1" : "0",
      base.evidence.evidenceComplete ? "1" : "0",
      base.evidence.fileIntegrityOk ? "1" : "0",
      base.evidence.requestedAmountWei,
      String(base.evidence.issuedAt),
      String(base.timestamp),
    ].join(":")
    const signature = await claimant.signMessage({ message })
    const res = await post({ ...base, signer: claimant.address, signature })
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/stale/)
  })

  it("signs a decision for a claimant-attested evidence bundle", async () => {
    const res = await post(await signedBody(claimant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
    // The evaluator key signs, not the claimant.
    expect(body.signer.toLowerCase()).toBe(evaluator.address.toLowerCase())
    expect(body.decision.claimId).toBe("1")
    expect(body.decision.coverageId).toBe("1")
    expect(body.decision.claimant.toLowerCase()).toBe(claimant.address.toLowerCase())
    expect(body.decision.evidenceHash.toLowerCase()).toBe(EVIDENCE_HASH.toLowerCase())
    expect(body.decision.amount).toBe("500000000000000")
    expect(body.model.decision).toBe("APPROVE")
  })

  it("signs a decision for a merchant-attested evidence bundle (coverage owner)", async () => {
    const res = await post(await signedBody(merchant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
    expect(body.model.decision).toBe("APPROVE")
  })

  it("returns a REJECT decision for attested evidence that fails the policy", async () => {
    const base = attestationBody()
    // Attest damageEligible=false: the deterministic policy rejects.
    const message = [
      "resvyn:evaluate",
      "677",
      TEST_CONTRACT,
      base.coverageId,
      base.claimId,
      EVIDENCE_HASH,
      base.evidence.productMatches ? "1" : "0",
      "0", // damageEligible signed false
      base.evidence.evidenceComplete ? "1" : "0",
      base.evidence.fileIntegrityOk ? "1" : "0",
      base.evidence.requestedAmountWei,
      String(base.evidence.issuedAt),
      String(base.timestamp),
    ].join(":")
    const signature = await claimant.signMessage({ message })
    const res = await post({
      ...base,
      signer: claimant.address,
      signature,
      evidence: { ...base.evidence, damageEligible: false },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.model.decision).toBe("REJECT")
    expect(body.decision.result).toBe(2)
    expect(body.decision.amount).toBe("0")
  })

  it("fails closed with no signature when Groq is configured but the provider fails (REV-006)", async () => {
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })) as typeof fetch
    try {
      const res = await post(await signedBody(claimant))
      // The Groq brain throws, evaluateAndSign propagates it, and the route
      // returns an error WITHOUT a signature.
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("sign_failed")
      expect(body.signature).toBeUndefined()
    } finally {
      globalThis.fetch = orig
      delete process.env.RESVYN_GROQ_KEY
    }
  })
})
