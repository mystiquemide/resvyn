import { recoverMessageAddress } from "viem"
import { evidenceContentHash, type EvidenceContent } from "./evidenceContent"

/*
 * REV-001 (round 2): server-owned evidence, client-authorized evaluation.
 *
 * Two distinct EIP-191 attestations:
 *
 *  1. INTAKE (POST /api/evidence): the claimant or merchant attests the
 *     evidence CONTENT under their key. The signed message binds the content
 *     hash (the exact hash the claim was opened with on-chain), the claim,
 *     the coverage, the chain, and the verifier. The server recomputes the
 *     content hash from the submitted content, requires it to equal the
 *     on-chain claim.evidenceHash, and stores the record server-side.
 *
 *  2. EVALUATE (POST /api/evaluate): the caller authorizes evaluation of a
 *     specific claim. The signed message binds ONLY chain/verifier/claim/
 *     coverage and a timestamp - NO evidence fields, NO amount. The server
 *     derives every signal and the payout from the server-owned evidence
 *     record bound to the on-chain hash, or refuses to sign.
 *
 * A caller who knows only public claim ids cannot forge either attestation;
 * a beneficiary cannot alter facts between intake and evaluation; and the
 * evaluate request itself carries no beneficiary-chosen settlement facts.
 */

export const ATTESTATION_MAX_AGE_SEC = 5 * 60

export class AttestationError extends Error {}

/* ------------------------------------------------------------------ *
 * 1) Evidence intake attestation
 * ------------------------------------------------------------------ */

export interface EvidenceIntakeAttestation {
  chainId: number
  verifier: `0x${string}`
  coverageId: string
  claimId: string
  evidenceHash: `0x${string}`
  content: EvidenceContent
  timestamp: number
}

/** The canonical, human-inspectable message the wallet signs for intake. */
export function intakeMessage(a: EvidenceIntakeAttestation): string {
  return [
    "resvyn:evidence",
    String(a.chainId),
    a.verifier,
    a.coverageId,
    a.claimId,
    a.evidenceHash,
    evidenceContentHash(a.content),
    String(a.timestamp),
  ].join(":")
}

export async function recoverIntakeSigner(
  att: EvidenceIntakeAttestation,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  try {
    return await recoverMessageAddress({ message: intakeMessage(att), signature })
  } catch {
    throw new AttestationError("Evidence attestation signature could not be verified.")
  }
}

/**
 * Verify an intake attestation. Throws AttestationError when stale, when the
 * content hash does not commit to the on-chain evidence hash, or when the
 * recovered signer is not an authorized party.
 */
export async function verifyEvidenceIntake(
  att: EvidenceIntakeAttestation,
  signature: `0x${string}`,
  opts: {
    chainId: number
    verifier: `0x${string}`
    onChainEvidenceHash: `0x${string}`
    authorized: [`0x${string}`, `0x${string}`]
    nowSec?: number
  },
): Promise<`0x${string}`> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)

  if (att.timestamp > now + 60) {
    throw new AttestationError("Attestation timestamp is in the future.")
  }
  if (now - att.timestamp > ATTESTATION_MAX_AGE_SEC) {
    throw new AttestationError("Attestation is stale. Sign again and retry.")
  }
  if (att.chainId !== opts.chainId) {
    throw new AttestationError("Attestation chain does not match this deployment.")
  }
  if (att.verifier.toLowerCase() !== opts.verifier.toLowerCase()) {
    throw new AttestationError("Attestation verifier does not match this contract.")
  }
  if (att.evidenceHash.toLowerCase() !== opts.onChainEvidenceHash.toLowerCase()) {
    throw new AttestationError(
      "Attestation evidence hash does not match the claim's on-chain evidence hash.",
    )
  }

  // The content must commit to exactly the on-chain hash: the server recomputes
  // the canonical content hash and compares. This is what makes the on-chain
  // hash a verifiable commitment to the server-seen content.
  const contentHash = evidenceContentHash(att.content)
  if (contentHash.toLowerCase() !== opts.onChainEvidenceHash.toLowerCase()) {
    throw new AttestationError(
      "Evidence content does not hash to the claim's on-chain evidence hash; refusing to store.",
    )
  }

  if (!/^\d+$/.test(att.content.requestedAmountWei)) {
    throw new AttestationError("requestedAmountWei must be decimal wei.")
  }

  const recovered = await recoverIntakeSigner(att, signature)
  const allowed = new Set(opts.authorized.map((a) => a.toLowerCase()))
  if (!allowed.has(recovered.toLowerCase())) {
    throw new AttestationError(
      "Evidence signer is neither the claim claimant nor the coverage merchant.",
    )
  }
  return recovered
}

/* ------------------------------------------------------------------ *
 * 2) Evaluate authorization attestation
 * ------------------------------------------------------------------ */

export interface EvaluateAttestation {
  chainId: number
  verifier: `0x${string}`
  coverageId: string
  claimId: string
  timestamp: number
}

/** The canonical message the wallet signs to authorize evaluation. */
export function evaluateMessage(a: EvaluateAttestation): string {
  return [
    "resvyn:evaluate",
    String(a.chainId),
    a.verifier,
    a.coverageId,
    a.claimId,
    String(a.timestamp),
  ].join(":")
}

export async function recoverEvaluateSigner(
  att: EvaluateAttestation,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  try {
    return await recoverMessageAddress({ message: evaluateMessage(att), signature })
  } catch {
    throw new AttestationError("Evaluation authorization signature could not be verified.")
  }
}

/**
 * Verify an evaluate authorization. Binds ONLY chain/verifier/claim/coverage
 * and a fresh timestamp. Throws AttestationError when stale or when the
 * recovered signer is not the claim claimant or coverage merchant.
 */
export async function verifyEvaluateAuthorization(
  att: EvaluateAttestation,
  signature: `0x${string}`,
  opts: {
    chainId: number
    verifier: `0x${string}`
    authorized: [`0x${string}`, `0x${string}`]
    nowSec?: number
  },
): Promise<`0x${string}`> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)

  if (att.timestamp > now + 60) {
    throw new AttestationError("Attestation timestamp is in the future.")
  }
  if (now - att.timestamp > ATTESTATION_MAX_AGE_SEC) {
    throw new AttestationError("Attestation is stale. Sign again and retry.")
  }
  if (att.chainId !== opts.chainId) {
    throw new AttestationError("Attestation chain does not match this deployment.")
  }
  if (att.verifier.toLowerCase() !== opts.verifier.toLowerCase()) {
    throw new AttestationError("Attestation verifier does not match this contract.")
  }

  const recovered = await recoverEvaluateSigner(att, signature)
  const allowed = new Set(opts.authorized.map((a) => a.toLowerCase()))
  if (!allowed.has(recovered.toLowerCase())) {
    throw new AttestationError(
      "Evaluation signer is neither the claim claimant nor the coverage merchant.",
    )
  }
  return recovered
}
