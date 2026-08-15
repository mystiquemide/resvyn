/*
 * Shared types for the evidence store. Split into its own module so the
 * dynamic-imported filesystem half (evidenceFs.ts) and the store itself
 * (evidenceStore.ts) agree on the record shape without a cycle.
 */

export interface StoredEvidence {
  /** The canonical content, exactly as verified against the chain hash. */
  content: {
    productNote: string
    receiptNote: string
    damageDescription: string
    damageEligible: boolean
    evidenceComplete: boolean
    fileIntegrityOk: boolean
    requestedAmountWei: string
    issuedAt: number
  }
  /**
   * Server-derived verification results (REV-001 round 3). These come from
   * the on-chain coverage commitments, never from the claimant:
   *   productMatches  = keccak(productNote) == coverage.productHash
   *   receiptMatches  = keccak(receiptNote) == coverage.receiptHash
   */
  derived: {
    productMatches: boolean
    receiptMatches: boolean
  }
  /** Address that submitted (claimant or merchant, recovered server-side). */
  submittedBy: `0x${string}`
  /** Unix seconds when the server accepted the record. */
  submittedAt: number
  /** Chain id + verifier the record was verified against. */
  chainId: number
  verifier: `0x${string}`
  /** Claim binding (REV-017): which claim this record was attested for. */
  claimId: string
  coverageId: string
}
