import { keccak256, toHex } from "viem"
import { z } from "zod"
import {
  CLAIM_DECISION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
} from "./chain"

/*
 * Resvyn claim evaluator (server-only).
 *
 * A faithful port of scripts/evaluator/{schema,policy,service}.ts into the web
 * app, so the /api/evaluate route runs the EXACT bounded logic the contract
 * verifies: the brain proposes a structured decision, a strict schema gate
 * refuses anything malformed, the service binds it to the on-chain claim, and
 * signs EIP-712 with the dedicated evaluator key. The brain never holds a key
 * and never sends a transaction (PLAN ADR-007, FR-008/FR-009).
 *
 * This module is imported ONLY from the route handler, so the signing path and
 * the key never reach the client bundle.
 */

/* ------------------------------------------------------------------ *
 * Decision schema (scripts/evaluator/schema.ts)
 * ------------------------------------------------------------------ */

export const APPROVE_REASON = "ELIGIBLE_DAMAGE_VERIFIED" as const

export const REJECT_REASONS = [
  "INELIGIBLE_CONDITION",
  "PRODUCT_MISMATCH",
  "DUPLICATE_EVIDENCE",
  "MISSING_EVIDENCE",
  "CORRUPTED_FILE",
  "STALE_CLAIM",
  "AMOUNT_EXCEEDS_CAP",
  "POLICY_UNCERTAIN",
] as const

export const REASON_CODES = [APPROVE_REASON, ...REJECT_REASONS] as const
export type ReasonCode = (typeof REASON_CODES)[number]

export const CONFIDENCE_BANDS = ["HIGH", "MEDIUM", "LOW"] as const

export const ModelDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    approvedAmount: z
      .string()
      .regex(/^\d+$/, "approvedAmount must be a decimal wei string"),
    reasonCode: z.enum(REASON_CODES),
    confidenceBand: z.enum(CONFIDENCE_BANDS),
    modelVersion: z.string().min(1),
  })
  .strict()
  .refine((d) => d.decision === "APPROVE" || d.approvedAmount === "0", {
    message: "A REJECT decision must have approvedAmount 0",
    path: ["approvedAmount"],
  })
  .refine((d) => d.decision === "REJECT" || d.approvedAmount !== "0", {
    message: "An APPROVE decision must have a positive approvedAmount",
    path: ["approvedAmount"],
  })
  .refine((d) => (d.decision === "APPROVE") === (d.reasonCode === APPROVE_REASON), {
    message: "reasonCode must match the decision (approval reason iff APPROVE)",
    path: ["reasonCode"],
  })

export type ModelDecision = z.infer<typeof ModelDecisionSchema>

/* ------------------------------------------------------------------ *
 * Policy engine (scripts/evaluator/policy.ts)
 * The engine branches ONLY on typed fields. Free text is audit-only and never
 * read to make or alter a decision (prompt-injection defense).
 * ------------------------------------------------------------------ */

export interface ClaimEvidence {
  productMatches: boolean
  damageEligible: boolean
  evidenceComplete: boolean
  fileIntegrityOk: boolean
  issuedAt: bigint
  requestedAmount: bigint
  evidenceHash: `0x${string}`
  receiptText?: string
  notes?: string
}

export interface PolicyContext {
  maxPayout: bigint
  asOf: bigint
  stalenessWindow: bigint
  seenEvidenceHashes: Set<string>
  modelVersion: string
}

function reject(reasonCode: ReasonCode, modelVersion: string): ModelDecision {
  return {
    decision: "REJECT",
    approvedAmount: "0",
    reasonCode,
    confidenceBand: "HIGH",
    modelVersion,
  }
}

export function evaluate(evidence: ClaimEvidence, ctx: PolicyContext): ModelDecision {
  const v = ctx.modelVersion

  if (!evidence.fileIntegrityOk) return reject("CORRUPTED_FILE", v)
  if (!evidence.evidenceComplete) return reject("MISSING_EVIDENCE", v)
  if (ctx.seenEvidenceHashes.has(evidence.evidenceHash.toLowerCase())) {
    return reject("DUPLICATE_EVIDENCE", v)
  }
  if (ctx.asOf - evidence.issuedAt > ctx.stalenessWindow) {
    return reject("STALE_CLAIM", v)
  }
  if (!evidence.productMatches) return reject("PRODUCT_MISMATCH", v)
  if (!evidence.damageEligible) return reject("INELIGIBLE_CONDITION", v)
  if (evidence.requestedAmount > ctx.maxPayout) return reject("AMOUNT_EXCEEDS_CAP", v)
  if (evidence.requestedAmount === 0n) return reject("POLICY_UNCERTAIN", v)

  return {
    decision: "APPROVE",
    approvedAmount: evidence.requestedAmount.toString(),
    reasonCode: APPROVE_REASON,
    confidenceBand: "HIGH",
    modelVersion: v,
  }
}

/* ------------------------------------------------------------------ *
 * Evaluator service (scripts/evaluator/service.ts)
 * ------------------------------------------------------------------ */

export const RESULT = { NONE: 0, APPROVE: 1, REJECT: 2 } as const

export interface ClaimDecision {
  chainId: bigint
  verifier: `0x${string}`
  claimId: bigint
  coverageId: bigint
  claimant: `0x${string}`
  evidenceHash: `0x${string}`
  amount: bigint
  result: number
  modelVersion: `0x${string}`
  expiry: bigint
  nonce: bigint
}

export interface DecisionBinding {
  chainId: bigint
  verifier: `0x${string}`
  claimId: bigint
  coverageId: bigint
  claimant: `0x${string}`
  evidenceHash: `0x${string}`
  nonce: bigint
  maxPayout: bigint
  asOf: bigint
  decisionTtl: bigint
}

export interface TypedDataSigner {
  address: `0x${string}`
  signTypedData: (args: {
    domain: {
      name: string
      version: string
      chainId: bigint
      verifyingContract: `0x${string}`
    }
    types: typeof CLAIM_DECISION_TYPES
    primaryType: "ClaimDecision"
    message: ClaimDecision
  }) => Promise<`0x${string}`>
}

export interface SignedEvaluation {
  model: ModelDecision
  decision: ClaimDecision
  signature: `0x${string}`
  signer: `0x${string}`
}

export class EvaluatorError extends Error {}

export type EvaluatorBrain = (
  evidence: ClaimEvidence,
  ctx: PolicyContext,
) => ModelDecision | unknown | Promise<ModelDecision | unknown>

export interface EvaluateOptions
  extends Partial<Pick<PolicyContext, "stalenessWindow" | "seenEvidenceHashes" | "modelVersion">> {
  brain?: EvaluatorBrain
}

/**
 * Run the brain, validate, bind, and sign. Throws EvaluatorError (and NEVER
 * produces a signature) if the brain output fails schema validation or if the
 * bound amount would exceed the coverage cap. A safe error, never a bad
 * signature.
 */
export async function evaluateAndSign(
  evidence: ClaimEvidence,
  binding: DecisionBinding,
  signer: TypedDataSigner,
  options: EvaluateOptions = {},
): Promise<SignedEvaluation> {
  const ctx: PolicyContext = {
    maxPayout: binding.maxPayout,
    asOf: binding.asOf,
    stalenessWindow: options.stalenessWindow ?? 30n * 24n * 3600n,
    seenEvidenceHashes: options.seenEvidenceHashes ?? new Set<string>(),
    modelVersion: options.modelVersion ?? "resvyn-eval-v1",
  }

  // The hash the brain inspects MUST be the hash the signature binds on-chain.
  if (evidence.evidenceHash.toLowerCase() !== binding.evidenceHash.toLowerCase()) {
    throw new EvaluatorError(
      `Evidence hash ${evidence.evidenceHash} does not match the bound claim hash ${binding.evidenceHash}, refusing to sign.`,
    )
  }

  const brain = options.brain ?? evaluate
  const raw = await brain(evidence, ctx)
  const parsed = ModelDecisionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new EvaluatorError(
      `Evaluator output failed schema validation, refusing to sign: ${parsed.error.message}`,
    )
  }
  const model = parsed.data

  const result = model.decision === "APPROVE" ? RESULT.APPROVE : RESULT.REJECT
  const amount = BigInt(model.approvedAmount)

  // Defense in depth: even a schema-valid approval cannot exceed the cap.
  if (result === RESULT.APPROVE && amount > binding.maxPayout) {
    throw new EvaluatorError(
      `Approved amount ${amount} exceeds coverage cap ${binding.maxPayout}, refusing to sign.`,
    )
  }

  const decision: ClaimDecision = {
    chainId: binding.chainId,
    verifier: binding.verifier,
    claimId: binding.claimId,
    coverageId: binding.coverageId,
    claimant: binding.claimant,
    evidenceHash: binding.evidenceHash,
    amount,
    result,
    modelVersion: keccak256(toHex(model.modelVersion)),
    expiry: binding.asOf + binding.decisionTtl,
    nonce: binding.nonce,
  }

  const signature = await signer.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: binding.chainId,
      verifyingContract: binding.verifier,
    },
    types: CLAIM_DECISION_TYPES,
    primaryType: "ClaimDecision",
    message: decision,
  })

  return { model, decision, signature, signer: signer.address }
}
