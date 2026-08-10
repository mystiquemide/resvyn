import { keccak256, toHex } from "viem";

import { ModelDecisionSchema, type ModelDecision } from "./schema.js";
import {
  evaluate,
  type ClaimEvidence,
  type PolicyContext,
} from "./policy.js";

// Resvyn claim evaluator service (PLAN component "Claim evaluator service":
// retrieve evidence, call the brain, validate schema, sign decision). This is
// the trust boundary. The brain (policy.ts today, a model provider later)
// proposes a structured decision; the service refuses to sign anything that
// fails schema validation, then binds it to the exact claim/coverage/chain and
// signs EIP-712 with the dedicated evaluator key. The brain never holds a key
// and never sends a transaction (PLAN ADR-007, FR-008/FR-009).

// DecisionResult enum, contract-side: None = 0, Approve = 1, Reject = 2.
export const RESULT = { NONE: 0, APPROVE: 1, REJECT: 2 } as const;

// EIP-712 type, byte-for-byte identical to the contract and the test suite.
export const DECISION_TYPES = {
  ClaimDecision: [
    { name: "chainId", type: "uint256" },
    { name: "verifier", type: "address" },
    { name: "claimId", type: "uint256" },
    { name: "coverageId", type: "uint256" },
    { name: "claimant", type: "address" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "result", type: "uint8" },
    { name: "modelVersion", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const DOMAIN_NAME = "Resvyn Warranty Reserve";
export const DOMAIN_VERSION = "1";

// The exact fields the contract verifies, as viem-ready values.
export interface ClaimDecision {
  chainId: bigint;
  verifier: `0x${string}`;
  claimId: bigint;
  coverageId: bigint;
  claimant: `0x${string}`;
  evidenceHash: `0x${string}`;
  amount: bigint;
  result: number;
  modelVersion: `0x${string}`;
  expiry: bigint;
  nonce: bigint;
}

// Contract-bound context the service enriches the raw decision with. These come
// from on-chain claim state, never from the brain, so the brain cannot retarget
// a decision at a different claim, chain, or claimant.
export interface DecisionBinding {
  chainId: bigint;
  verifier: `0x${string}`;
  claimId: bigint;
  coverageId: bigint;
  claimant: `0x${string}`;
  evidenceHash: `0x${string}`;
  nonce: bigint;
  maxPayout: bigint;
  asOf: bigint; // unix seconds, injected (keeps this pure/testable)
  decisionTtl: bigint; // seconds until the signed decision expires
}

// Minimal shape of a viem account/wallet that can sign typed data. Keeping it
// structural means the caller supplies the key; the service never sees raw key
// material beyond the sign call.
export interface TypedDataSigner {
  address: `0x${string}`;
  signTypedData: (args: {
    domain: {
      name: string;
      version: string;
      chainId: bigint;
      verifyingContract: `0x${string}`;
    };
    types: typeof DECISION_TYPES;
    primaryType: "ClaimDecision";
    message: ClaimDecision;
  }) => Promise<`0x${string}`>;
}

export interface SignedEvaluation {
  model: ModelDecision; // the validated raw brain output (audit record)
  decision: ClaimDecision; // the contract-bound, signed payload
  signature: `0x${string}`;
  signer: `0x${string}`;
}

export class EvaluatorError extends Error {}

// The evaluator "brain": maps evidence + context to a proposed decision. The
// default is the deterministic policy engine; a model provider can be injected
// with the same signature later. Its output is UNTRUSTED and always passes
// through schema validation before signing.
export type EvaluatorBrain = (
  evidence: ClaimEvidence,
  ctx: PolicyContext,
) => ModelDecision | unknown;

export interface EvaluateOptions
  extends Partial<Pick<PolicyContext, "stalenessWindow" | "seenEvidenceHashes" | "modelVersion">> {
  brain?: EvaluatorBrain;
}

// Run the brain, validate, bind, and sign. Throws EvaluatorError (and NEVER
// produces a signature) if the brain output fails schema validation or if the
// bound amount would exceed the coverage cap. A safe error, never a bad
// signature (PLAN FR-008, NFR-010).
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
  };

  // Consistency gate: the hash the brain inspects and dedups on MUST be the same
  // hash the signature binds on-chain. Otherwise the evaluator could audit one
  // piece of evidence and sign a decision pointing at another. The contract also
  // checks the bound hash against the claim (EvidenceMismatch); we refuse earlier
  // so no divergent decision is ever built.
  if (evidence.evidenceHash.toLowerCase() !== binding.evidenceHash.toLowerCase()) {
    throw new EvaluatorError(
      `Evidence hash ${evidence.evidenceHash} does not match the bound claim hash ${binding.evidenceHash}, refusing to sign.`,
    );
  }

  // 1) Brain proposes (default policy engine, or an injected provider).
  // 2) Schema is the gate: never sign malformed output.
  const brain = options.brain ?? evaluate;
  const raw = brain(evidence, ctx);
  const parsed = ModelDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EvaluatorError(
      `Evaluator output failed schema validation, refusing to sign: ${parsed.error.message}`,
    );
  }
  const model = parsed.data;

  const result = model.decision === "APPROVE" ? RESULT.APPROVE : RESULT.REJECT;
  const amount = BigInt(model.approvedAmount);

  // Defense in depth: even a schema-valid approval cannot exceed the coverage
  // cap. The contract enforces this too (AmountOutOfRange); we refuse earlier so
  // no over-cap signature is ever created.
  if (result === RESULT.APPROVE && amount > binding.maxPayout) {
    throw new EvaluatorError(
      `Approved amount ${amount} exceeds coverage cap ${binding.maxPayout}, refusing to sign.`,
    );
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
    // Bind the human-readable model version string to the on-chain bytes32.
    modelVersion: keccak256(toHex(model.modelVersion)),
    expiry: binding.asOf + binding.decisionTtl,
    nonce: binding.nonce,
  };

  const signature = await signer.signTypedData({
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: binding.chainId,
      verifyingContract: binding.verifier,
    },
    types: DECISION_TYPES,
    primaryType: "ClaimDecision",
    message: decision,
  });

  return { model, decision, signature, signer: signer.address };
}
