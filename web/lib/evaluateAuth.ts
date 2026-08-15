import { recoverMessageAddress } from "viem"

/*
 * REV-001: /api/evaluate must never sign caller-controlled eligibility facts
 * from an anonymous request. This module turns the evidence bundle into an
 * ATTESTATION: the caller must be the on-chain claim claimant or the coverage
 * merchant, and must sign a canonical EIP-191 message binding every evidence
 * field plus the claim/coverage/chain binding. The server recovers the
 * signer, checks it against live chain state, checks the evidence hash inside
 * the signed message against the on-chain claim, and only then evaluates.
 *
 * The signature therefore proves provenance ("the party that owns this claim
 * asserts these facts under its key") and makes every field tamper-evident.
 * A public caller who knows only the public claim ids cannot produce a
 * signature from the claimant/merchant key, so no approval can be requested
 * or signed for a claim they do not control.
 */

export interface EvidenceAttestation {
  chainId: number
  verifier: `0x${string}`
  coverageId: string
  claimId: string
  evidenceHash: `0x${string}`
  productMatches: boolean
  damageEligible: boolean
  evidenceComplete: boolean
  fileIntegrityOk: boolean
  requestedAmountWei: string
  issuedAt: number
  timestamp: number
}

/** The canonical, human-inspectable message the wallet signs (EIP-191). */
export function attestationMessage(a: EvidenceAttestation): string {
  return [
    "resvyn:evaluate",
    String(a.chainId),
    a.verifier,
    a.coverageId,
    a.claimId,
    a.evidenceHash,
    a.productMatches ? "1" : "0",
    a.damageEligible ? "1" : "0",
    a.evidenceComplete ? "1" : "0",
    a.fileIntegrityOk ? "1" : "0",
    a.requestedAmountWei,
    String(a.issuedAt),
    String(a.timestamp),
  ].join(":")
}

/** How old a signed attestation may be before it is refused (seconds). */
export const ATTESTATION_MAX_AGE_SEC = 5 * 60

export class AttestationError extends Error {}

/**
 * Verify a signed evidence attestation. Throws AttestationError on any
 * missing, stale, forged, or misbound payload. Returns the recovered signer
 * on success.
 */
export async function verifyEvidenceAttestation(
  att: EvidenceAttestation,
  signature: `0x${string}`,
  opts: {
    /** Live chain id the decision will bind to. */
    chainId: number
    /** Contract the decision will bind to. */
    verifier: `0x${string}`
    /** On-chain claim.evidenceHash. */
    onChainEvidenceHash: `0x${string}`
    /** Addresses allowed to attest: [claimant, merchant] from chain state. */
    authorized: [`0x${string}`, `0x${string}`]
    nowSec?: number
  },
): Promise<`0x${string}`> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)

  // Freshness: a signed attestation is a short-lived authorization.
  if (att.timestamp > now + 60) {
    throw new AttestationError("Attestation timestamp is in the future.")
  }
  if (now - att.timestamp > ATTESTATION_MAX_AGE_SEC) {
    throw new AttestationError("Attestation is stale. Sign again and retry.")
  }

  // Binding: the signed message must describe exactly this chain/contract/
  // claim, and the evidence hash must be the one the claim is bound to.
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

  // Amount sanity: the policy re-checks against the live cap, but refuse
  // obviously malformed amounts before any evaluation work.
  if (!/^\d+$/.test(att.requestedAmountWei)) {
    throw new AttestationError("requestedAmountWei must be decimal wei.")
  }

  // Provenance: recover the signer and require claim ownership.
  const recovered = await recoverAttestationSigner(att, signature)
  const allowed = new Set(opts.authorized.map((a) => a.toLowerCase()))
  if (!allowed.has(recovered.toLowerCase())) {
    throw new AttestationError(
      "Attestation signer is neither the claim claimant nor the coverage merchant.",
    )
  }

  return recovered
}

export async function recoverAttestationSigner(
  att: EvidenceAttestation,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  try {
    return await recoverMessageAddress({
      message: attestationMessage(att),
      signature,
    })
  } catch {
    throw new AttestationError("Attestation signature could not be verified.")
  }
}
