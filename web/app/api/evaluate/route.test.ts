import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { privateKeyToAccount } from "viem/accounts"
import { keccak256, stringToHex } from "viem"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { writeFileSync, rmSync, readFileSync } from "node:fs"
import { evidenceContentHash, noteHash } from "@/lib/evidenceContent"
import { resetEvidenceStoreForTests } from "@/lib/evidenceStore"
import { evaluateMessage, intakeMessage } from "@/lib/evaluateAuth"

// Route integration tests for POST /api/evidence and POST /api/evaluate
// (REV-001 round 2, REV-002 round 2, REV-011).
//
// Trust boundary under test:
//  - Evidence is attested ONCE via /api/evidence; the content must hash to
//    the claim's on-chain evidence hash, and the signer must be the on-chain
//    claimant or coverage merchant. The record is stored server-side.
//  - /api/evaluate carries NO evidence fields; it loads the server-owned
//    record bound to claim.evidenceHash and fails closed when missing.
//  - The route reads the contract's evaluatorSigner and requires it to match
//    the configured server key (exact deployment gate).

const CLAIMANT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const MERCHANT_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
const EVALUATOR_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
const UNRELATED_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"

const TEST_CONTRACT = "0x1111111111111111111111111111111111111111" as `0x${string}`

const claimant = privateKeyToAccount(CLAIMANT_KEY)
const merchant = privateKeyToAccount(MERCHANT_KEY)
const evaluator = privateKeyToAccount(EVALUATOR_KEY)

// The evidence content the claim was "opened" with on-chain: its canonical
// hash is the claim's evidenceHash, exactly like the AppConsole flow.
// issuedAt is recent (module load) so the policy's staleness window passes.
const ISSUED_AT = Math.floor(Date.now() / 1000) - 3600
const evidenceContent = {
  productNote: "Alpine kettle, batch A12",
  receiptNote: "Store ticket 1842",
  damageDescription: "Cracked base after normal use",
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  requestedAmountWei: "500000000000000",
  issuedAt: ISSUED_AT,
}
const EVIDENCE_HASH = evidenceContentHash(evidenceContent)

// The evidence hash the mocked contract reports for claim #1. Tests that
// attest a different content variant point this at the variant's hash.
let fixtureEvidenceHash: `0x${string}` = EVIDENCE_HASH
function setFixtureEvidenceHash(h: `0x${string}`) {
  fixtureEvidenceHash = h
}

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
  readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
    switch (functionName) {
      case "coverageOf": {
        const id = Number((args?.[0] as bigint) ?? 1n)
        // Coverage 1's on-chain hashes commit to the fixture notes; coverage 2
        // commits to a DIFFERENT product so derived productMatches differs.
        if (id === 2) {
          return {
            merchant: merchant.address,
            claimant: claimant.address,
            productHash: noteHash("coverage-two-product"),
            receiptHash: noteHash("coverage-two-receipt"),
            maxPayout: 1000000000000000n,
            expiry: 2000000000n,
            status: 1,
          }
        }
        return {
          merchant: merchant.address,
          claimant: claimant.address,
          productHash: noteHash(evidenceContent.productNote),
          receiptHash: noteHash(evidenceContent.receiptNote),
          maxPayout: 1000000000000000n, // 0.001 BOT
          expiry: 2000000000n,
          status: 1,
        }
      }
      case "claimOf": {
        const id = Number((args?.[0] as bigint) ?? 1n)
        // Claim 1 is the fixture claim; claim 2 reuses the SAME evidence hash
        // to test claim-bound records (REV-017).
        return {
          coverageId: BigInt(id),
          claimant: claimant.address,
          evidenceHash: fixtureEvidenceHash,
          paidAmount: 0n,
          status: 1, // Open
          openedAt: 1755000000n,
        }
      }
      case "isNonceUsed":
        return false
      case "evaluatorSigner":
        // Matches RESVYN_EVALUATOR_KEY: the exact deployment gate passes.
        return evaluator.address
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

async function postIntake(body: unknown): Promise<Response> {
  const { POST } = await import("../evidence/route")
  return POST(new Request("http://localhost/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

async function postEvaluate(body: unknown): Promise<Response> {
  const { POST } = await import("./route")
  return POST(new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

async function intakeBody(
  signer: ReturnType<typeof privateKeyToAccount>,
  overrides: { content?: Partial<typeof evidenceContent>; evidenceHash?: string; timestamp?: number } = {},
) {
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000)
  const content = { ...evidenceContent, ...(overrides.content ?? {}) }
  const evidenceHash = (overrides.evidenceHash ?? fixtureEvidenceHash) as `0x${string}`
  const msg = intakeMessage({
    chainId: 677,
    verifier: TEST_CONTRACT,
    coverageId: "1",
    claimId: "1",
    evidenceHash: evidenceHash as `0x${string}`,
    content,
    timestamp,
  })
  const signature = await signer.signMessage({ message: msg })
  return {
    coverageId: "1",
    claimId: "1",
    evidence: content,
    signer: signer.address,
    signature,
    timestamp,
  }
}

async function evaluateBody(
  signer: ReturnType<typeof privateKeyToAccount>,
  overrides: { timestamp?: number; coverageId?: string; claimId?: string } = {},
) {
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000)
  const msg = evaluateMessage({
    chainId: 677,
    verifier: TEST_CONTRACT,
    coverageId: overrides.coverageId ?? "1",
    claimId: overrides.claimId ?? "1",
    timestamp,
  })
  const signature = await signer.signMessage({ message: msg })
  return {
    coverageId: overrides.coverageId ?? "1",
    claimId: overrides.claimId ?? "1",
    signer: signer.address,
    signature,
    timestamp,
  }
}

// --- Tests ----------------------------------------------------------------

describe("POST /api/evidence (REV-001 round 2)", () => {
  beforeAll(() => {
    delete process.env.RESVYN_GROQ_KEY
    process.env.RESVYN_RATE_LIMIT_MAX = "1000"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "10000"
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "10000"
  })

  beforeEach(() => {
    resetEvidenceStoreForTests()
    fixtureEvidenceHash = EVIDENCE_HASH
  })

  afterAll(() => {
    delete process.env.RESVYN_GROQ_KEY
    delete process.env.RESVYN_RATE_LIMIT_MAX
    delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
    delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
    resetEvidenceStoreForTests()
  })

  it("refuses evidence whose content does not commit to the on-chain hash", async () => {
    const body = await intakeBody(claimant, {
      content: { ...evidenceContent, damageEligible: false },
    })
    const res = await postIntake(body)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("attestation_invalid")
  })

  it("refuses evidence dated in the future (would bypass staleness)", async () => {
    const body = await intakeBody(claimant, {
      content: { ...evidenceContent, issuedAt: Math.floor(Date.now() / 1000) + 3600 },
    })
    const res = await postIntake(body)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("future_issued_at")
  })

  it("stores evidence whose product note commits to the coverage's on-chain product hash", async () => {
    const res = await postIntake(await intakeBody(claimant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.derived.productMatches).toBe(true)
    expect(body.derived.receiptMatches).toBe(true)
  })

  it("derives productMatches=false when the note does not match the coverage hash (REV-001r3)", async () => {
    // Coverage 2 commits to different product/receipt hashes (see mock).
    const mismatched = { ...evidenceContent, productNote: "some other product" }
    const mismatchedHash = evidenceContentHash(mismatched)
    setFixtureEvidenceHash(mismatchedHash) // claim 2's on-chain hash
    const timestamp = Math.floor(Date.now() / 1000)
    const msg = intakeMessage({
      chainId: 677,
      verifier: TEST_CONTRACT,
      coverageId: "2",
      claimId: "2",
      evidenceHash: mismatchedHash,
      content: mismatched,
      timestamp,
    })
    const signature = await claimant.signMessage({ message: msg })
    const res = await postIntake({
      coverageId: "2",
      claimId: "2",
      evidence: mismatched,
      signer: claimant.address,
      signature,
      timestamp,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.derived.productMatches).toBe(false)
  })

  it("refuses evidence signed by a key that owns neither claim nor coverage", async () => {
    const unrelated = privateKeyToAccount(UNRELATED_KEY)
    const res = await postIntake(await intakeBody(unrelated))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("attestation_invalid")
  })

  it("refuses stale evidence attestations", async () => {
    const body = await intakeBody(claimant, {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    })
    const res = await postIntake(body)
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/stale/)
  })

  it("stores claimant-attested evidence that commits to the on-chain hash", async () => {
    const res = await postIntake(await intakeBody(claimant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.evidenceHash.toLowerCase()).toBe(EVIDENCE_HASH.toLowerCase())
  })

  it("stores merchant-attested evidence (coverage owner) and rejects re-submission", async () => {
    // Seed a claimant record for this claim first (first write wins).
    const first = await postIntake(await intakeBody(claimant))
    expect(first.status).toBe(200)
    // The merchant's submission for the SAME claim must be refused: no
    // contradictory records, no settlement race.
    const res = await postIntake(await intakeBody(merchant))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("evidence_conflict")
  })
})

describe("GET /api/evidence (REV-016 round 4: browser rehydration)", () => {
  beforeAll(() => {
    delete process.env.RESVYN_GROQ_KEY
    process.env.RESVYN_RATE_LIMIT_MAX = "1000"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "10000"
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "10000"
  })

  beforeEach(() => {
    resetEvidenceStoreForTests()
    fixtureEvidenceHash = EVIDENCE_HASH
  })

  afterAll(() => {
    delete process.env.RESVYN_GROQ_KEY
    delete process.env.RESVYN_RATE_LIMIT_MAX
    delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
    delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
    resetEvidenceStoreForTests()
  })

  async function getStatus(coverageId = "1", claimId = "1") {
    const { GET } = await import("../evidence/route")
    return GET(new Request(`http://localhost/api/evidence?coverageId=${coverageId}&claimId=${claimId}`))
  }

  it("reports attested=false for a claim with no record (after reload)", async () => {
    resetEvidenceStoreForTests()
    const res = await getStatus()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attested).toBe(false)
    expect(body.coverageId).toBe("1")
    expect(body.claimId).toBe("1")
  })

  it("reports attested=true with hash/derived (no raw content) after intake (reload recovery)", async () => {
    resetEvidenceStoreForTests()
    const intake = await postIntake(await intakeBody(claimant))
    expect(intake.status).toBe(200)
    // Simulate a reload: the client asks the server for the record.
    const res = await getStatus()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attested).toBe(true)
    expect(body.evidenceHash.toLowerCase()).toBe(EVIDENCE_HASH.toLowerCase())
    expect(body.derived.productMatches).toBe(true)
    expect(body.derived.receiptMatches).toBe(true)
    // REV-005 round 5: raw evidence content is NOT exposed to unauthenticated
    // callers; the browser only needs the attested flag.
    expect(body.content).toBeUndefined()
  })

  it("is claim-bound: another claim with the same hash reports unattested", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // claim 1
    const res = await getStatus("2", "2")
    expect(res.status).toBe(200)
    expect((await res.json()).attested).toBe(false)
  })

  it("fails closed with 503 when the store cannot be written (REV-005r4 persistence)", async () => {
    resetEvidenceStoreForTests()
    // A path whose parent is a FILE: mkdir/write fails immediately and
    // deterministically (no /proc tricks that can hang).
    const blocker = join(tmpdir(), `resvyn-blocker-${process.pid}`)
    writeFileSync(blocker, "not a directory")
    process.env.RESVYN_EVIDENCE_STORE_PATH = join(blocker, "evidence-store.json")
    try {
      const res = await postIntake(await intakeBody(claimant))
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toBe("evidence_store_failed")
      // Nothing was stored: a retry with a healthy store succeeds.
      delete process.env.RESVYN_EVIDENCE_STORE_PATH
      resetEvidenceStoreForTests()
      const retry = await postIntake(await intakeBody(claimant))
      expect(retry.status).toBe(200)
    } finally {
      delete process.env.RESVYN_EVIDENCE_STORE_PATH
      rmSync(blocker, { force: true })
    }
  })

  it("fails closed when the persisted store is corrupt: no reads, no overwrite (REV-005r5)", async () => {
    resetEvidenceStoreForTests()
    const corrupt = join(tmpdir(), `resvyn-corrupt-${process.pid}.json`)
    writeFileSync(corrupt, "{ this is not valid json")
    process.env.RESVYN_EVIDENCE_STORE_PATH = corrupt
    const { __forceReinitForTests } = await import("@/lib/evidenceStore")
    __forceReinitForTests()
    try {
      // Intake must refuse (store unavailable), not silently start empty.
      const res = await postIntake(await intakeBody(claimant))
      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe("evidence_store_failed")
      // The corrupt file must NOT have been overwritten by an empty store.
      expect(readFileSync(corrupt, "utf8")).toBe("{ this is not valid json")
      // Reads fail closed too.
      const { GET } = await import("../evidence/route")
      const status = await GET(new Request("http://localhost/api/evidence?coverageId=1&claimId=1"))
      expect(status.status).toBe(200)
      expect((await status.json()).attested).toBe(false)
    } finally {
      delete process.env.RESVYN_EVIDENCE_STORE_PATH
      rmSync(corrupt, { force: true })
    }
  })
})

describe("POST /api/evaluate (REV-001 round 2)", () => {
  beforeAll(() => {
    process.env.RESVYN_EVALUATOR_KEY = EVALUATOR_KEY
    delete process.env.RESVYN_GROQ_KEY
    process.env.RESVYN_RATE_LIMIT_MAX = "1000"
    process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX = "10000"
    process.env.RESVYN_RATE_LIMIT_CLAIM_MAX = "10000"
  })

  beforeEach(() => {
    resetEvidenceStoreForTests()
    fixtureEvidenceHash = EVIDENCE_HASH
  })

  afterAll(() => {
    delete process.env.RESVYN_EVALUATOR_KEY
    delete process.env.RESVYN_GROQ_KEY
    delete process.env.RESVYN_RATE_LIMIT_MAX
    delete process.env.RESVYN_RATE_LIMIT_GLOBAL_MAX
    delete process.env.RESVYN_RATE_LIMIT_CLAIM_MAX
    resetEvidenceStoreForTests()
  })

  it("fails closed when no server-owned evidence record exists for the claim", async () => {
    resetEvidenceStoreForTests()
    const res = await postEvaluate(await evaluateBody(claimant))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("evidence_not_attested")
    expect(body.signature).toBeUndefined()
  })

  it("refuses an authorization signed by a key that owns neither claim nor coverage", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // seed the record
    const unrelated = privateKeyToAccount(UNRELATED_KEY)
    const res = await postEvaluate(await evaluateBody(unrelated))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("authorization_invalid")
  })

  it("refuses a stale evaluation authorization", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // seed the record
    const res = await postEvaluate(
      await evaluateBody(claimant, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).message).toMatch(/stale/)
  })

  it("signs a decision for a claimant-authorized evaluation of attested evidence", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // seed the record
    const res = await postEvaluate(await evaluateBody(claimant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
    expect(body.signer.toLowerCase()).toBe(evaluator.address.toLowerCase())
    expect(body.decision.claimId).toBe("1")
    expect(body.decision.coverageId).toBe("1")
    expect(body.decision.claimant.toLowerCase()).toBe(claimant.address.toLowerCase())
    expect(body.decision.evidenceHash.toLowerCase()).toBe(EVIDENCE_HASH.toLowerCase())
    expect(body.decision.amount).toBe("500000000000000")
    expect(body.model.decision).toBe("APPROVE")
  })

  it("returns a REJECT decision for attested evidence that fails the policy", async () => {
    resetEvidenceStoreForTests()
    // The claim was opened with the hash of the damageEligible=false variant:
    // point the fixture at that variant's hash, then attest it.
    const rejectedContent = { ...evidenceContent, damageEligible: false }
    setFixtureEvidenceHash(evidenceContentHash(rejectedContent))
    const intake = await postIntake(await intakeBody(claimant, { content: rejectedContent }))
    expect(intake.status).toBe(200)
    const res = await postEvaluate(await evaluateBody(claimant))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.model.decision).toBe("REJECT")
    expect(body.decision.result).toBe(2)
    expect(body.decision.amount).toBe("0")
  })

  it("returns a REJECT when the product note does not match the coverage hash (REV-001r3)", async () => {
    resetEvidenceStoreForTests()
    // Claim 2's coverage commits to different product/receipt hashes, so the
    // server-derived productMatches is false even though the claimant
    // attested a well-formed bundle.
    const mismatchedContent = { ...evidenceContent, productNote: "some other product" }
    const hash = evidenceContentHash(mismatchedContent)
    setFixtureEvidenceHash(hash)
    const timestamp = Math.floor(Date.now() / 1000)
    const msg = intakeMessage({
      chainId: 677,
      verifier: TEST_CONTRACT,
      coverageId: "2",
      claimId: "2",
      evidenceHash: hash,
      content: mismatchedContent,
      timestamp,
    })
    const signature = await claimant.signMessage({ message: msg })
    const intake = await postIntake({
      coverageId: "2",
      claimId: "2",
      evidence: mismatchedContent,
      signer: claimant.address,
      signature,
      timestamp,
    })
    expect(intake.status).toBe(200)
    expect((await intake.json()).derived.productMatches).toBe(false)
    const res = await postEvaluate(await evaluateBody(claimant, { coverageId: "2", claimId: "2" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.model.decision).toBe("REJECT")
    expect(body.model.reasonCode).toBe("PRODUCT_MISMATCH")
  })

  it("refuses to reuse another claim's evidence record (REV-017 claim-bound)", async () => {
    resetEvidenceStoreForTests()
    // Claim 1 attests its evidence; claim 2 uses the SAME public evidence
    // hash on-chain (mock returns fixtureEvidenceHash for every claim).
    await postIntake(await intakeBody(claimant))
    // Evaluate claim 2: the record is bound to claim 1 -> refuse.
    const res = await postEvaluate(await evaluateBody(claimant, { coverageId: "2", claimId: "2" }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("evidence_claim_mismatch")
    expect(body.signature).toBeUndefined()
  })

  it("rejects duplicate evidence across claims via the seen-hash set (REV-017)", async () => {
    resetEvidenceStoreForTests()
    // Claim 1 attests evidence with hash H. Claim 2's on-chain evidenceHash
    // is ALSO H (same public hash). The claim-bound check refuses first, but
    // even if the store were shared, the seen-hash seeding must make the
    // policy treat H as duplicate for claim 2.
    await postIntake(await intakeBody(claimant))
    const { getSeenEvidenceHashes } = await import("@/lib/evidenceStore")
    const seen = await getSeenEvidenceHashes("2")
    expect(seen.has(EVIDENCE_HASH.toLowerCase())).toBe(true)
    // And evaluating claim 2 is refused outright (claim-bound).
    const res = await postEvaluate(await evaluateBody(claimant, { coverageId: "2", claimId: "2" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("evidence_claim_mismatch")
  })

  it("fails closed with no signature when Groq is configured but the provider fails (REV-006)", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // seed the record
    process.env.RESVYN_GROQ_KEY = "gsk_bogus"
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })) as typeof fetch
    try {
      const res = await postEvaluate(await evaluateBody(claimant))
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

describe("POST /api/evaluate deployment gate (REV-002 round 2)", () => {
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
    resetEvidenceStoreForTests()
  })

  it("refuses to sign when the on-chain evaluator signer does not match the server key", async () => {
    resetEvidenceStoreForTests()
    await postIntake(await intakeBody(claimant)) // seed the record
    // The contract's immutable evaluatorSigner points elsewhere.
    fakeClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "evaluatorSigner") {
        return "0x2222222222222222222222222222222222222222"
      }
      // Default fixture behavior for every other read.
      switch (functionName) {
        case "coverageOf":
          return { merchant: merchant.address, claimant: claimant.address, productHash: noteHash(evidenceContent.productNote), receiptHash: noteHash(evidenceContent.receiptNote), maxPayout: 1000000000000000n, expiry: 2000000000n, status: 1 }
        case "claimOf":
          return { coverageId: 1n, claimant: claimant.address, evidenceHash: EVIDENCE_HASH, paidAmount: 0n, status: 1, openedAt: 1755000000n }
        case "isNonceUsed":
          return false
        default:
          throw new Error(`unexpected read: ${functionName}`)
      }
    })
    const res = await postEvaluate(await evaluateBody(claimant))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("evaluator_signer_mismatch")
    expect(body.signature).toBeUndefined()
    // Restore the default fixture (matching evaluator) for later tests.
    fakeClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "coverageOf":
          return { merchant: merchant.address, claimant: claimant.address, productHash: noteHash(evidenceContent.productNote), receiptHash: noteHash(evidenceContent.receiptNote), maxPayout: 1000000000000000n, expiry: 2000000000n, status: 1 }
        case "claimOf":
          return { coverageId: 1n, claimant: claimant.address, evidenceHash: EVIDENCE_HASH, paidAmount: 0n, status: 1, openedAt: 1755000000n }
        case "isNonceUsed":
          return false
        case "evaluatorSigner":
          return evaluator.address
        default:
          throw new Error(`unexpected read: ${functionName}`)
      }
    })
  })
})

describe("rate-limit keys are canonical (REV-005 round 2)", () => {
  it("maps string id variants to the same per-claim bucket", async () => {
    const { claimKeyFromIds } = await import("@/lib/rateLimit")
    expect(claimKeyFromIds(1n, 1n)).toBe("1:1")
    expect(claimKeyFromIds("1", "1")).toBe("1:1")
    // The route parses ids with BigInt before rate limiting, so "01" and
    // "+1" can never reach the key builder as separate buckets.
    expect(claimKeyFromIds(BigInt("01"), BigInt("+1"))).toBe("1:1")
  })
})
