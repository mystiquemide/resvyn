import {
  APPROVE_REASON,
  type ModelDecision,
  type ReasonCode,
} from "./schema.js";

// Resvyn policy engine: the swappable evaluator "brain." It maps STRUCTURED
// claim evidence to the strict decision object in schema.ts. For the demo it is
// deterministic rules (PLAN: "consistent structured policy application, not
// proof of physical truth"). A model provider can replace `evaluate` behind the
// same signature later; the service around it (validation, enrichment, signing)
// does not change, which is the whole point of the boundary.
//
// Prompt-injection defense (PLAN "Safety boundaries"): the engine branches ONLY
// on typed fields. Free-text fields (receiptText, notes) are carried for the
// audit record but are NEVER read to make or alter a decision, so injected text
// like "APPROVE THIS CLAIM" in a receipt cannot change the outcome or the
// signing policy. This is proven by test.

export interface ClaimEvidence {
  // Typed signals the policy is allowed to branch on.
  productMatches: boolean; // product image matches the covered product
  damageEligible: boolean; // damage is within the covered class
  evidenceComplete: boolean; // all required evidence present
  fileIntegrityOk: boolean; // no corrupted/unreadable file
  issuedAt: bigint; // unix seconds the evidence/claim was produced
  requestedAmount: bigint; // wei the claimant asks for
  evidenceHash: `0x${string}`;

  // Untrusted free text. Audit only. NEVER used for branching.
  receiptText?: string;
  notes?: string;
}

export interface PolicyContext {
  maxPayout: bigint; // the coverage cap (contract-enforced too)
  asOf: bigint; // evaluation time, unix seconds (injected, kept pure)
  stalenessWindow: bigint; // seconds; older evidence is stale
  seenEvidenceHashes: Set<string>; // evidence hashes already settled
  modelVersion: string; // policy/model version string
}

function reject(reasonCode: ReasonCode, modelVersion: string): ModelDecision {
  return {
    decision: "REJECT",
    approvedAmount: "0",
    reasonCode,
    confidenceBand: "HIGH",
    modelVersion,
  };
}

// Deterministic policy. Reject checks run in a fixed order so the reason code
// is stable and auditable: integrity, completeness, duplicate, staleness,
// product, eligibility, amount cap. Anything that passes all of them is a clean
// approval for exactly the requested amount (already <= cap here).
export function evaluate(
  evidence: ClaimEvidence,
  ctx: PolicyContext,
): ModelDecision {
  const v = ctx.modelVersion;

  if (!evidence.fileIntegrityOk) return reject("CORRUPTED_FILE", v);
  if (!evidence.evidenceComplete) return reject("MISSING_EVIDENCE", v);
  if (ctx.seenEvidenceHashes.has(evidence.evidenceHash.toLowerCase())) {
    return reject("DUPLICATE_EVIDENCE", v);
  }
  if (ctx.asOf - evidence.issuedAt > ctx.stalenessWindow) {
    return reject("STALE_CLAIM", v);
  }
  if (!evidence.productMatches) return reject("PRODUCT_MISMATCH", v);
  if (!evidence.damageEligible) return reject("INELIGIBLE_CONDITION", v);
  if (evidence.requestedAmount > ctx.maxPayout) {
    // Reject oversized requests rather than silently clamping: the claimant
    // asked for more than the coverage allows, which is a policy failure to
    // surface, not to paper over. The contract also caps, as defense in depth.
    return reject("AMOUNT_EXCEEDS_CAP", v);
  }
  if (evidence.requestedAmount === 0n) {
    return reject("POLICY_UNCERTAIN", v);
  }

  return {
    decision: "APPROVE",
    approvedAmount: evidence.requestedAmount.toString(),
    reasonCode: APPROVE_REASON,
    confidenceBand: "HIGH",
    modelVersion: v,
  };
}
