import { NextResponse } from "next/server"
import { createPublicClient, http, getAddress } from "viem"
import { z } from "zod"
import {
  APP_CHAIN,
  APP_CONTRACT_ADDRESS,
  isArchivedProofInstance,
  warrantyReserveAbi,
} from "@/lib/chain"
import { evidenceContentHash, type EvidenceContent } from "@/lib/evidenceContent"
import { putEvidence } from "@/lib/evidenceStore"
import {
  AttestationError,
  verifyEvidenceIntake,
  type EvidenceIntakeAttestation,
} from "@/lib/evaluateAuth"
import { checkRateLimit, clientKeyFromRequest, claimKeyFromIds } from "@/lib/rateLimit"

// REV-001 (round 2): server-owned evidence intake.
//
// The claimant or merchant attests the evidence CONTENT under their key. The
// server:
//   1. requires the content to hash to the claim's ON-CHAIN evidence hash
//      (the claim was opened with that hash, so the chain commitment now
//      verifiably commits to exactly this server-seen content);
//   2. requires the claim to be open and bound to the submitted coverage;
//   3. requires the signer to be the on-chain claimant or coverage merchant;
//   4. stores the record server-side, first-write-wins (immutable).
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
  productMatches: z.boolean(),
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

  // 1) Rate limit with canonical keys (REV-005 round 2).
  const limit = checkRateLimit(
    clientKeyFromRequest(req),
    claimKeyFromIds(coverageId, claimId),
  )
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many requests. Retry in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
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

  // 4) Verify the attestation: content must commit to the on-chain hash and
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

  // 5) Store server-side, first-write-wins (immutable). The route hashes the
  //    content itself; the stored key is the on-chain hash.
  const stored = putEvidence(claim.evidenceHash as `0x${string}`, {
    content,
    submittedBy,
    submittedAt: Math.floor(Date.now() / 1000),
    chainId: APP_CHAIN.id,
    verifier: contract,
  })
  if (!stored.ok) {
    return NextResponse.json({ error: "evidence_conflict", message: stored.reason ?? "Evidence already stored." }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    evidenceHash: evidenceContentHash(content),
    submittedBy,
  })
}
