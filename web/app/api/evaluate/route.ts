import { NextResponse } from "next/server"
import { createPublicClient, http, getAddress, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { z } from "zod"
import { APP_CHAIN, APP_CONTRACT_ADDRESS, warrantyReserveAbi } from "@/lib/chain"
import {
  evaluateAndSign,
  EvaluatorError,
  type ClaimEvidence,
  type DecisionBinding,
} from "@/lib/evaluator.server"
import { groqBrain, isGroqConfigured } from "@/lib/groqBrain"
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit"

// The evaluator API. The bounded brain proposes a decision, the schema gate
// refuses malformed output, and the decision is bound to the LIVE on-chain
// claim (chain 677) before it is signed with the dedicated evaluator key.
//
// Trust boundary rules honored here:
//  - The signing key is read from server env (RESVYN_EVALUATOR_KEY) only. If it
//    is absent, the route returns an honest "not configured" error and NEVER a
//    fake or self-generated signature.
//  - chainId, verifier, claimId, coverageId, claimant, evidenceHash, and the
//    coverage cap all come from the chain, never from the request body, so the
//    caller cannot retarget a decision at a different claim, chain, or amount.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// How long a signed decision stays valid (seconds). The relayer must submit
// resolveClaim within this window or the contract rejects it as expired.
const DECISION_TTL = 3600n

const BodySchema = z.object({
  coverageId: z.union([z.string(), z.number()]),
  claimId: z.union([z.string(), z.number()]),
  evidence: z.object({
    productMatches: z.boolean(),
    damageEligible: z.boolean(),
    evidenceComplete: z.boolean(),
    fileIntegrityOk: z.boolean(),
    requestedAmountWei: z.string().regex(/^\d+$/, "requestedAmountWei must be decimal wei"),
    issuedAtSecondsAgo: z.number().int().nonnegative().max(315360000).optional(),
  }),
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
  // 0) Rate limit: the signing endpoint must not be freely spammable. 429 with
  //    Retry-After when a client exceeds RESVYN_RATE_LIMIT_MAX per window.
  const limit = checkRateLimit(clientKeyFromRequest(req))
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many evaluate requests. Retry in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    )
  }

  // 1) Mainnet contract must be configured.
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

  // 2) Evaluator key must be configured server-side. No key, no signature.
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

  // 3) Parse and validate the request body.
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

  const contract = getAddress(APP_CONTRACT_ADDRESS)
  const client = createPublicClient({ chain: APP_CHAIN, transport: http() })

  // 4) Read the LIVE claim and coverage state. The binding comes from here.
  let coverage, claim, nonceUsed: boolean
  try {
    ;[coverage, claim, nonceUsed] = await Promise.all([
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "coverageOf", args: [coverageId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "claimOf", args: [claimId] }),
      client.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "isNonceUsed", args: [claimId] }),
    ])
  } catch (e) {
    return NextResponse.json(
      { error: "chain_read_failed", message: `Could not read the contract on chain ${APP_CHAIN.id}: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // 5) State gates, so the UI gets a clean reason instead of a raw revert.
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

  // 6) Build evidence (typed signals from the client) + binding (chain state).
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const issuedAgo = BigInt(parsed.evidence.issuedAtSecondsAgo ?? 3600)
  const evidence: ClaimEvidence = {
    productMatches: parsed.evidence.productMatches,
    damageEligible: parsed.evidence.damageEligible,
    evidenceComplete: parsed.evidence.evidenceComplete,
    fileIntegrityOk: parsed.evidence.fileIntegrityOk,
    issuedAt: nowSec - issuedAgo,
    requestedAmount: BigInt(parsed.evidence.requestedAmountWei),
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

  // 7) Evaluate + sign. Policy may APPROVE or REJECT; both are signed decisions
  //    the contract verifies. evaluateAndSign only throws (no signature) on
  //    malformed output or an over-cap approval. When RESVYN_GROQ_KEY is set,
  //    Groq is the brain (hard-signal gate first, safe fallback on any failure);
  //    otherwise the deterministic policy is the brain.
  try {
    const account = privateKeyToAccount(key)
    const { model, decision, signature, signer } = await evaluateAndSign(evidence, binding, account, {
      brain: isGroqConfigured() ? groqBrain : undefined,
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
