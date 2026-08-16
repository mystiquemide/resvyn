import { NextResponse } from "next/server"
import { createPublicClient, http, getAddress } from "viem"
import { z } from "zod"
import {
  APP_CHAIN,
  APP_CONTRACT_ADDRESS,
  isArchivedProofInstance,
  warrantyReserveAbi,
} from "@/lib/chain"
import { evidenceContentHash, noteHash, type EvidenceContent } from "@/lib/evidenceContent"
import { getEvidenceByClaim, putEvidence } from "@/lib/evidenceStore"
import {
  AttestationError,
  verifyEvidenceIntake,
  type EvidenceIntakeAttestation,
} from "@/lib/evaluateAuth"
import { checkClientLimit, clientKeyFromRequest, claimKeyFromIds, consumeClaimBudget, consumeGlobalBudget } from "@/lib/rateLimit"

// REV-001 (round 3): server-owned evidence intake with server-derived checks.
//
// The claimant or merchant attests the evidence CONTENT under their key. The
// server:
//   1. requires the content to hash to the claim's ON-CHAIN evidence hash
//      (the claim was opened with that hash, so the chain commitment now
//      verifiably commits to exactly this server-seen content);
//   2. requires the claim to be open and bound to the submitted coverage;
//   3. requires the signer to be the on-chain claimant or coverage merchant;
//   4. DERIVES productMatches and receiptMatches server-side by comparing
//      keccak(productNote)/keccak(receiptNote) against the coverage's on-chain
//      productHash/receiptHash - the merchant committed those at issuance, so
//      this is independent of whatever the claimant asserts;
//   5. rejects future-dated issuedAt (would bypass the staleness check);
//   6. stores the record server-side, first-write-wins (immutable), bound to
//      the claim and coverage it was attested for (REV-017).
//
// POST /api/evaluate then reads ONLY this store - the evaluate request
// carries no evidence fields at all - and refuses to sign when no record
// exists for the claim's evidence hash.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ContentSchema = z.object({
  productNote: z.string().min(1).max(2000),
  receiptNote: z.string().min(1).max(2000),
  damageDescription: z.string().max(4000).default(""),
  damageEligible: z.boolean(),
  evidenceComplete: z.boolean(),
  fileIntegrityOk: z.boolean(),
  requestedAmountWei: z.string().regex(/^\d+$/, "requestedAmountWei must be decimal wei"),
  issuedAt: z.number().int().nonnegative(),
})

const BodySchema = z.object({
  coverageId: z.union([z.string(), z.number()]),
  claimId: z.union([z.string(), z.number()]),
  evidence: ContentSchema,
  signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  timestamp: z.number().int().nonnegative(),
})

function toId(v: string | number): bigint {
  const b = BigInt(v)
  if (b <= 0n) throw new Error("id must be positive")
  return b
}

export async function POST(req: Request) {
  // 0) Parse the body BEFORE rate limiting so the per-claim key is the
  //    canonical decimal id, not an attacker-chosen string form ("01", "+1").
  let parsed
  try {
    parsed = BodySchema.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", message: e instanceof Error ? e.message : "Invalid request body." },
      { status: 400 },
    )
  }
  let coverageId: bigint, claimId: bigint
  try {
    coverageId = toId(parsed.coverageId)
    claimId = toId(parsed.claimId)
  } catch {
    return NextResponse.json({ error: "bad_request", message: "coverageId and claimId must be positive integers." }, { status: 400 })
  }

  // 1) Cheap per-client rate limit (claim/global budgets are only consumed
  //    after authentication and at the write point, REV-005 rounds 3/4).
  const limit = checkClientLimit(clientKeyFromRequest(req))
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many requests. Retry in ${Math.ceil((limit.retryAfterMs ?? 1000) / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 1) / 1000)) },
      },
    )
  }

  // 2) Contract configured + not the archived proof instance (REV-002).
  if (!APP_CONTRACT_ADDRESS) {
    return NextResponse.json({ error: "contract_not_configured", message: "The Resvyn contract address is not configured." }, { status: 503 })
  }
  if (isArchivedProofInstance(APP_CONTRACT_ADDRESS)) {
    return NextResponse.json(
      {
        error: "archived_instance_read_only",
        message: "The configured contract is the archived Mainnet proof instance, which is read-only. Evidence intake is disabled for it.",
      },
      { status: 403 },
    )
  }

  const contract = getAddress(APP_CONTRACT_ADDRESS)
  const client = createPublicClient({ chain: APP_CHAIN, transport: http() })

  // 3) Read LIVE claim and coverage state.
  let coverage, claim
  try {
    ;[coverage, claim] = await Promise.all([
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "coverageOf", args: [coverageId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "claimOf", args: [claimId] }),
    ])
  } catch (e) {
    return NextResponse.json(
      { error: "chain_read_failed", message: `Could not read the contract on chain ${APP_CHAIN.id}: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  if (claim.status !== 1) {
    return NextResponse.json({ error: "claim_not_open", message: `Claim #${claimId} is not open (status ${claim.status}).` }, { status: 409 })
  }
  if (claim.coverageId !== coverageId) {
    return NextResponse.json({ error: "coverage_mismatch", message: `Claim #${claimId} belongs to coverage #${claim.coverageId}, not #${coverageId}.` }, { status: 422 })
  }

  // 4) REV-001 round 3: reject future-dated damage claims. A future issuedAt
  //    would make the policy's staleness window (asOf - issuedAt) negative
  //    and bypass it. Allow a small clock-skew grace.
  const nowSec = Math.floor(Date.now() / 1000)
  if (parsed.evidence.issuedAt > nowSec + 300) {
    return NextResponse.json(
      { error: "future_issued_at", message: "issuedAt is in the future; evidence cannot be dated after submission." },
      { status: 400 },
    )
  }

  // 5) Verify the attestation: content must commit to the on-chain hash and
  //    the signer must be claimant or merchant.
  const content: EvidenceContent = parsed.evidence
  const att: EvidenceIntakeAttestation = {
    chainId: APP_CHAIN.id,
    verifier: contract,
    coverageId: coverageId.toString(),
    claimId: claimId.toString(),
    evidenceHash: claim.evidenceHash as `0x${string}`,
    content,
    timestamp: parsed.timestamp,
  }
  let submittedBy: `0x${string}`
  try {
    submittedBy = await verifyEvidenceIntake(att, parsed.signature as `0x${string}`, {
      chainId: APP_CHAIN.id,
      verifier: contract,
      onChainEvidenceHash: claim.evidenceHash as `0x${string}`,
      authorized: [getAddress(claim.claimant), getAddress(coverage.merchant)],
    })
  } catch (e) {
    if (e instanceof AttestationError) {
      return NextResponse.json({ error: "attestation_invalid", message: e.message }, { status: 403 })
    }
    return NextResponse.json({ error: "attestation_invalid", message: "Attestation could not be verified." }, { status: 403 })
  }

  // 6) REV-001 round 3: derive the verifiable eligibility facts SERVER-SIDE
  //    from the on-chain coverage commitments. The claimant's assertions are
  //    audit-only for these fields; the decision uses these derived values.
  const derivedProductMatches =
    noteHash(content.productNote).toLowerCase() ===
    (coverage.productHash as `0x${string}`).toLowerCase()
  const derivedReceiptMatches =
    noteHash(content.receiptNote).toLowerCase() ===
    (coverage.receiptHash as `0x${string}`).toLowerCase()

  // 7) REV-005 rounds 3/4: consume the claim budget only AFTER the
  //    attestation verified (invalid signatures cannot burn a known claim's
  //    allowance), then the global budget BEFORE the immutable write so a
  //    rate-limited intake stores nothing and can be retried.
  const claimLimit = consumeClaimBudget(claimKeyFromIds(coverageId, claimId))
  if (!claimLimit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many requests for this claim. Retry in ${Math.ceil((claimLimit.retryAfterMs ?? 1000) / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((claimLimit.retryAfterMs ?? 1) / 1000)) },
      },
    )
  }
  const global = consumeGlobalBudget()
  if (!global.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Server is at capacity. Retry in ${Math.ceil((global.retryAfterMs ?? 1000) / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((global.retryAfterMs ?? 1) / 1000)) },
      },
    )
  }

  // 8) Store server-side, first-write-wins (immutable), claim-bound. The
  //    route hashes the content itself; the stored key is the on-chain hash.
  //    putEvidence is DISK-FIRST and fails closed (round 4): if the disk
  //    write fails, nothing is stored and the caller can retry.
  const stored = await putEvidence(claim.evidenceHash as `0x${string}`, {
    content,
    derived: {
      productMatches: derivedProductMatches,
      receiptMatches: derivedReceiptMatches,
    },
    submittedBy,
    submittedAt: nowSec,
    chainId: APP_CHAIN.id,
    verifier: contract,
    claimId: claimId.toString(),
    coverageId: coverageId.toString(),
  })
  if (!stored.ok) {
    // write_failed/unavailable are 5xx (transient, retryable). conflict is a
    // 409 (immutable). "full" is a server-capacity condition: 503, and the
    // client must NOT treat it as a successful attestation.
    if (stored.code === "write_failed" || stored.code === "unavailable") {
      return NextResponse.json(
        { error: "evidence_store_failed", message: stored.reason, evidenceHash: evidenceContentHash(content) },
        { status: 503 },
      )
    }
    if (stored.code === "full") {
      return NextResponse.json(
        { error: "evidence_store_full", message: stored.reason, evidenceHash: evidenceContentHash(content) },
        { status: 503 },
      )
    }
    return NextResponse.json(
      {
        error: "evidence_conflict",
        message: stored.reason ?? "Evidence already stored.",
        evidenceHash: evidenceContentHash(content),
      },
      { status: 409 },
    )
  }

  return NextResponse.json({
    ok: true,
    evidenceHash: evidenceContentHash(content),
    submittedBy,
    derived: { productMatches: derivedProductMatches, receiptMatches: derivedReceiptMatches },
  })
}

/**
 * REV-016 round 4: status/recovery read for the browser flow. After a
 * reload the React snapshot is gone; this endpoint tells the UI whether the
 * claim already has a server-owned record (and returns the stored content)
 * so Evaluate can be re-enabled instead of stranding the user.
 *
 * Read-only: no rate-limit budget is consumed (client limit only), and the
 * archived instance is allowed to answer (the record store is the same).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const coverageRaw = url.searchParams.get("coverageId")
  const claimRaw = url.searchParams.get("claimId")
  if (!coverageRaw || !claimRaw) {
    return NextResponse.json({ error: "bad_request", message: "coverageId and claimId are required." }, { status: 400 })
  }
  let coverageId: bigint, claimId: bigint
  try {
    coverageId = toId(coverageRaw)
    claimId = toId(claimRaw)
  } catch {
    return NextResponse.json({ error: "bad_request", message: "coverageId and claimId must be positive integers." }, { status: 400 })
  }

  const limit = checkClientLimit(clientKeyFromRequest(req))
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", message: "Too many requests." }, { status: 429 })
  }

  const record = await getEvidenceByClaim(coverageId.toString(), claimId.toString())
  if (!record) {
    return NextResponse.json({ attested: false, coverageId: coverageId.toString(), claimId: claimId.toString() })
  }
  // Round 5: do NOT return the raw evidence content to unauthenticated
  // callers. The browser only needs the attested flag (+ hash + derived
  // summary) to re-enable evaluation; the content itself stays server-side.
  return NextResponse.json({
    attested: true,
    coverageId: coverageId.toString(),
    claimId: claimId.toString(),
    evidenceHash: evidenceContentHash(record.content),
    derived: record.derived,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt,
  })
}
