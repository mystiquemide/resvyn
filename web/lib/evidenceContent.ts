import { keccak256, stringToHex } from "viem"

/*
 * REV-001 (round 2): server-owned evidence commitments.
 *
 * The on-chain claim binds ONE evidence hash. This module defines the
 * canonical, order-independent serialization of the claim evidence content
 * and the hash the claim must be opened with. The server re-derives this hash
 * from the content submitted to /api/evidence and requires it to equal the
 * claim's on-chain evidenceHash, so the chain commitment verifiably commits
 * to exactly the server-seen content. Nothing else may be signed.
 *
 * Client-safe: imported by the browser (to compute the hash at claim
 * opening) and by the server routes (to verify the commitment).
 */

export interface EvidenceContent {
  /** Free text the merchant side can cross-check against coverage.productHash. */
  productNote: string
  /** Free text cross-checkable against coverage.receiptHash. */
  receiptNote: string
  /** Free-text damage description (audit trail; never a decision field). */
  damageDescription: string
  productMatches: boolean
  damageEligible: boolean
  evidenceComplete: boolean
  fileIntegrityOk: boolean
  /** Decimal wei string. */
  requestedAmountWei: string
  /** Unix seconds the damage is claimed to have occurred. */
  issuedAt: number
}

/**
 * Canonical JSON: keys sorted recursively so client and server always derive
 * the identical string regardless of object key order or insertion order.
 */
export function canonicalEvidenceJson(content: EvidenceContent): string {
  function sortValue(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortValue)
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortValue((v as Record<string, unknown>)[k])
      }
      return out
    }
    return v
  }
  return JSON.stringify(sortValue(content))
}

/** The exact hash a claim must be opened with for its evidence content. */
export function evidenceContentHash(content: EvidenceContent): `0x${string}` {
  return keccak256(stringToHex(canonicalEvidenceJson(content)))
}
