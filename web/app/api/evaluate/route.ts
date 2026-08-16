import { NextResponse } from "next/server"
import { createPublicClient, http, getAddress, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { z } from "zod"
import {
  APP_CHAIN,
  APP_CONTRACT_ADDRESS,
  isArchivedProofInstance,
  warrantyReserveAbi,
} from "@/lib/chain"
import {
  evaluateAndSign,
  EvaluatorError,
  type ClaimEvidence,
  type DecisionBinding,
} from "@/lib/evaluator.server"
import { groqBrain, isGroqConfigured } from "@/lib/groqBrain"
import { getEvidence, getSeenEvidenceHashes } from "@/lib/evidenceStore"
import { checkClientLimit, clientKeyFromRequest, claimKeyFromIds, consumeClaimBudget, consumeGlobalBudget } from "@/lib/rateLimit"
import {
  AttestationError,
  verifyEvaluateAuthorization,
  type EvaluateAttestation,
} from "@/lib/evaluateAuth"

// The evaluator API. The bounded brain proposes a decision, the schema gate
// refuses malformed output, and the decision is bound to the LIVE on-chain
// claim (chain 677) before it is signed with the dedicated evaluator key.
//
// Trust boundary rules honored here (REV-001 round 2):
//  - The request body carries NO evidence fields and NO amount. It contains
//    only the claim/coverage references plus a fresh EIP-191 authorization
//    signed by the on-chain claim claimant or coverage merchant.
//  - EVERY evidence signal and the requested amount come from the server-owned
//    evidence record stored at POST /api/evidence, keyed by the claim's
//    on-chain evidenceHash. The server recomputed that hash from the stored
//    content, so the chain commitment verifiably commits to the stored facts.
//  - If no server-owned record exists for the claim's evidence hash, the
//    route FAILS CLOSED with no signature.
//  - The signing key is read from server env (RESVYN_EVALUATOR_KEY) only. If
//    it is absent, the route returns an honest "not configured" error.
//  - REV-002: the route reads the contract's immutable evaluatorSigner and
//    requires it to EXACTLY match the address derived from the server signing
//    key. A misconfigured deployment (wrong contract, wrong key, archived
//    instance) returns no signature.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// How long a signed decision stays valid (seconds). The relayer must submit
// resolveClaim within this window or the contract rejects it as expired.
const DECISION_TTL = 3600n

const BodySchema = z.object({
  coverageId: z.union([z.string(), z.number()]),
  claimId: z.union([z.string(), z.number()]),
  // EIP-191 signature over the canonical evaluate authorization message
  // (web/lib/evaluateAuth.ts). Proves the caller owns this claim.
  signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  timestamp: z.number().int().nonnegative(),
})

function toId(v: string | number): bigint {
  const b = BigInt(v)
  if (b <= 0n) throw new Error("id must be positive")
  return b
}

// Stringify bigints so the decision survives JSON to the browser, which rebuilds
// them before calling resolveClaim.
function serializeDecision(d: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) out[k] = typeof v === "bigint" ? v.toString() : v
  return out
}

export async function POST(req: Request) {
  // 0) Parse the body BEFORE rate limiting so the per-claim key is the
  //    canonical decimal id, not an attacker-chosen string form (REV-005).
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

  // 1) Cheap per-client rate limit (REV-005). The client key only uses
  //    forwarding headers behind a trusted proxy; the per-claim and global
  //    budgets are consumed AFTER authorization and at the signing point
  //    (rounds 3/4), so invalid signatures or cheap floods cannot exhaust
  //    them.
  const limit = checkClientLimit(clientKeyFromRequest(req))
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many evaluate requests. Retry in ${Math.ceil((limit.retryAfterMs ?? 1000) / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 1) / 1000)) },
      },
    )
  }

  // 2) Mainnet contract must be configured.
  if (!APP_CONTRACT_ADDRESS) {
    return NextResponse.json(
      {
        error: "contract_not_configured",
        message:
          "The Resvyn contract address is not configured. Set NEXT_PUBLIC_RESVYN_ADDRESS to the WarrantyReserve on BOT Chain Mainnet.",
      },
      { status: 503 },
    )
  }

  // 3) REV-002: refuse to sign for the archived proof instance.
  if (isArchivedProofInstance(APP_CONTRACT_ADDRESS)) {
    return NextResponse.json(
      {
        error: "archived_instance_read_only",
        message:
          "The configured contract is the archived Mainnet proof instance, which is read-only. No evaluator decision will be signed for it.",
      },
      { status: 403 },
    )
  }

  // 4) Evaluator key must be configured server-side. No key, no signature.
  const rawKey = process.env.RESVYN_EVALUATOR_KEY?.trim()
  if (!rawKey) {
    return NextResponse.json(
      {
        error: "evaluator_not_configured",
        message:
          "The evaluator signing key is not configured on the server (RESVYN_EVALUATOR_KEY). The evaluator cannot sign a decision until an operator provisions it.",
      },
      { status: 503 },
    )
  }
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`
  if (!isHex(key) || key.length !== 66) {
    return NextResponse.json(
      { error: "evaluator_key_invalid", message: "RESVYN_EVALUATOR_KEY is not a valid 32-byte hex private key." },
      { status: 500 },
    )
  }
  const serverSigner = privateKeyToAccount(key).address

  const contract = getAddress(APP_CONTRACT_ADDRESS)
  const client = createPublicClient({ chain: APP_CHAIN, transport: http() })

  // 5) Read the LIVE claim, coverage, nonce, and the contract's immutable
  //    evaluator signer. The binding comes from here.
  let coverage, claim, nonceUsed: boolean, onChainEvaluator: `0x${string}`
  try {
    ;[coverage, claim, nonceUsed, onChainEvaluator] = await Promise.all([
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "coverageOf", args: [coverageId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "claimOf", args: [claimId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "isNonceUsed", args: [claimId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "evaluatorSigner" }),
    ])
  } catch (e) {
    return NextResponse.json(
      { error: "chain_read_failed", message: `Could not read the contract on chain ${APP_CHAIN.id}: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // 6) REV-002 round 2: the deployment gate must be exact. The contract's
  //    immutable evaluatorSigner must equal the address derived from the
  //    server signing key, or the deployment is misconfigured: signatures
  //    would never settle. Fail closed.
  if (onChainEvaluator.toLowerCase() !== serverSigner.toLowerCase()) {
    return NextResponse.json(
      {
        error: "evaluator_signer_mismatch",
        message:
          "The contract's immutable evaluator signer does not match the configured server signing key (RESVYN_EVALUATOR_KEY). This deployment cannot settle any claim; no decision was signed.",
      },
      { status: 503 },
    )
  }

  // 7) State gates, so the UI gets a clean reason instead of a raw revert.
  if (claim.status !== 1) {
    const label = claim.status === 2 ? "already approved" : claim.status === 3 ? "already rejected" : "not open"
    return NextResponse.json(
      { error: "claim_not_open", message: `Claim #${claimId} is ${label} (status ${claim.status}). Only an open claim can be resolved.` },
      { status: 409 },
    )
  }
  if (claim.coverageId !== coverageId) {
    return NextResponse.json(
      { error: "coverage_mismatch", message: `Claim #${claimId} belongs to coverage #${claim.coverageId}, not #${coverageId}.` },
      { status: 422 },
    )
  }
  if (nonceUsed) {
    return NextResponse.json(
      { error: "nonce_used", message: `A decision for claim #${claimId} has already settled. The nonce is burned.` },
      { status: 409 },
    )
  }

  // 8) REV-001 round 2: verify the caller is the claimant or merchant
  //    (authorization only - the request carries no evidence fields).
  const att: EvaluateAttestation = {
    chainId: APP_CHAIN.id,
    verifier: contract,
    coverageId: coverageId.toString(),
    claimId: claimId.toString(),
    timestamp: parsed.timestamp,
  }
  try {
    await verifyEvaluateAuthorization(att, parsed.signature as `0x${string}`, {
      chainId: APP_CHAIN.id,
      verifier: contract,
      authorized: [getAddress(claim.claimant), getAddress(coverage.merchant)],
    })
  } catch (e) {
    if (e instanceof AttestationError) {
      return NextResponse.json({ error: "authorization_invalid", message: e.message }, { status: 403 })
    }
    return NextResponse.json({ error: "authorization_invalid", message: "Authorization could not be verified." }, { status: 403 })
  }

  // 9) REV-001 round 3: load the SERVER-OWNED evidence record bound to the
  //    on-chain evidence hash. No record -> fail closed, no signature.
  const record = await getEvidence(claim.evidenceHash as `0x${string}`)
  if (!record) {
    return NextResponse.json(
      {
        error: "evidence_not_attested",
        message:
          "No server-owned evidence record exists for this claim's on-chain evidence hash. Submit the evidence at POST /api/evidence first; no decision can be signed from caller-supplied facts.",
      },
      { status: 409 },
    )
  }
  if (
    record.chainId !== APP_CHAIN.id ||
    record.verifier.toLowerCase() !== contract.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "evidence_misbound", message: "The stored evidence record was verified against a different chain or contract." },
      { status: 503 },
    )
  }
  // REV-017: the record is claim-bound. A second claim reusing the same
  // public evidence hash must NOT be able to borrow the first claim's record.
  if (record.claimId !== claimId.toString() || record.coverageId !== coverageId.toString()) {
    return NextResponse.json(
      {
        error: "evidence_claim_mismatch",
        message: `The stored evidence record for this hash was attested for claim #${record.claimId} on coverage #${record.coverageId}, not claim #${claimId} on coverage #${coverageId}. A claim must attest its own evidence.`,
      },
      { status: 409 },
    )
  }

  // 10) Build evidence EXCLUSIVELY from the stored record + chain state.
  //     REV-001 round 3: productMatches/receiptMatches come from the
  //     SERVER-DERIVED comparison against the coverage's on-chain
  //     productHash/receiptHash, never from the claimant's assertions.
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const evidence: ClaimEvidence = {
    productMatches: record.derived.productMatches && record.derived.receiptMatches,
    damageEligible: record.content.damageEligible,
    evidenceComplete: record.content.evidenceComplete,
    fileIntegrityOk: record.content.fileIntegrityOk,
    issuedAt: BigInt(record.content.issuedAt),
    requestedAmount: BigInt(record.content.requestedAmountWei),
    evidenceHash: claim.evidenceHash,
  }
  const binding: DecisionBinding = {
    chainId: BigInt(APP_CHAIN.id),
    verifier: contract,
    claimId,
    coverageId,
    claimant: getAddress(claim.claimant),
    evidenceHash: claim.evidenceHash,
    nonce: claimId,
    maxPayout: coverage.maxPayout,
    asOf: nowSec,
    decisionTtl: DECISION_TTL,
  }

  // 11) REV-017: seed the policy's duplicate-evidence set with hashes already
  //     attested for OTHER claims. The same public evidence hash used by a
  //     second claim is rejected as DUPLICATE_EVIDENCE instead of passing.
  const seenHashes = await getSeenEvidenceHashes(claimId.toString())

  // 12) REV-005 rounds 3/4: the claim budget is consumed only AFTER the
  //     authorization verified (invalid signatures cannot burn a known
  //     claim's allowance), and the global signing budget only at the point
  //     of signing. Neither is consumed by cheap or rejected requests.
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

  // 13) Evaluate + sign. Policy may APPROVE or REJECT; both are signed
  //     decisions the contract verifies. evaluateAndSign only throws (no
  //     signature) on malformed output or an over-cap approval. REV-006: any
  //     Groq/provider failure FAILS CLOSED (no signature).
  try {
    const account = privateKeyToAccount(key)
    const { model, decision, signature, signer } = await evaluateAndSign(evidence, binding, account, {
      brain: isGroqConfigured() ? groqBrain : undefined,
      seenEvidenceHashes: seenHashes,
    })
    return NextResponse.json({
      model,
      decision: serializeDecision(decision as unknown as Record<string, unknown>),
      signature,
      signer,
      evaluator: signer,
    })
  } catch (e) {
    if (e instanceof EvaluatorError) {
      return NextResponse.json({ error: "evaluator_refused", message: e.message }, { status: 422 })
    }
    return NextResponse.json(
      { error: "sign_failed", message: e instanceof Error ? e.message : "Failed to sign the decision." },
      { status: 500 },
    )
  }
}
