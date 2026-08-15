import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { privateKeyToAccount } from "viem/accounts"
import { keccak256, stringToHex } from "viem"

// REV-002 server gate: the archived Mainnet proof instance must refuse to
// sign evaluator decisions even with a perfectly valid attestation, because
// its immutable evaluator signer is no longer in use. Writes and signing are
// read-only on that instance.

const CLAIMANT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const EVALUATOR_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"

// The recorded Mainnet proof deployment address (web/lib/chain.ts PROOF).
const PROOF_CONTRACT = "0x414592d2313d233b673b1f97803c261355ccd996" as `0x${string}`
const EVIDENCE_HASH = keccak256(stringToHex("damage-photos-and-receipt"))

const claimant = privateKeyToAccount(CLAIMANT_KEY)

vi.mock("@/lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chain")>()
  return {
    ...actual,
    APP_CHAIN: actual.botMainnet,
    APP_CONTRACT_ADDRESS: PROOF_CONTRACT,
  }
})

const fakeClient = {
  readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "coverageOf":
        return { merchant: claimant.address, claimant: claimant.address, maxPayout: 1000000000000000n, expiry: 2000000000n, status: 1 }
      case "claimOf":
        return { coverageId: 1n, claimant: claimant.address, evidenceHash: EVIDENCE_HASH, paidAmount: 0n, status: 1, openedAt: 1755000000n }
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

describe("POST /api/evaluate archived instance gate (REV-002)", () => {
  beforeAll(() => {
    process.env.RESVYN_EVALUATOR_KEY = EVALUATOR_KEY
    delete process.env.RESVYN_GROQ_KEY
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

  it("refuses to sign for the archived proof instance", async () => {
    const { POST } = await import("./route")
    const timestamp = Math.floor(Date.now() / 1000)
    const evidence = {
      productMatches: true,
      damageEligible: true,
      evidenceComplete: true,
      fileIntegrityOk: true,
      requestedAmountWei: "500000000000000",
      issuedAt: timestamp - 3600,
    }
    const message = [
      "resvyn:evaluate",
      "677",
      PROOF_CONTRACT,
      "1",
      "1",
      EVIDENCE_HASH,
      "1",
      "1",
      "1",
      "1",
      evidence.requestedAmountWei,
      String(evidence.issuedAt),
      String(timestamp),
    ].join(":")
    const signature = await claimant.signMessage({ message })

    const res = await POST(new Request("http://localhost/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        coverageId: "1",
        claimId: "1",
        evidence,
        signer: claimant.address,
        signature,
        timestamp,
      }),
    }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("archived_instance_read_only")
    expect(body.signature).toBeUndefined()
  })
})
