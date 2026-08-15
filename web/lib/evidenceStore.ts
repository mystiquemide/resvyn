/*
 * REV-001 (round 2): server-owned evidence store.
 *
 * Evidence is submitted ONCE to POST /api/evidence (authenticated claimant or
 * merchant), verified against live chain state (claim open, coverage match,
 * content hash == on-chain claim.evidenceHash), and stored here keyed by the
 * on-chain hash. POST /api/evaluate then derives EVERY signal and amount from
 * this record - the request body carries no evidence fields at all - and
 * refuses to sign when no record exists for the claim's evidence hash.
 *
 * Properties:
 *  - Server-owned: the route never accepts beneficiary-selected facts at
 *    evaluation time; it reads them from this store.
 *  - Hash-bound: the store key must equal the on-chain claim.evidenceHash,
 *    which the server independently recomputes from the submitted content.
 *  - Immutable + first-write-wins: a hash can be stored only once, so
 *    contradictory submissions or a settlement race are impossible; a second
 *    submission for the same claim is rejected.
 *  - Single-instance: like the rate limiter, this lives in process memory and
 *    is correct for the current one-server deployment. A multi-instance
 *    deployment must move it to a shared store.
 */

export interface StoredEvidence {
  /** The canonical content, exactly as verified against the chain hash. */
  content: {
    productNote: string
    receiptNote: string
    damageDescription: string
    productMatches: boolean
    damageEligible: boolean
    evidenceComplete: boolean
    fileIntegrityOk: boolean
    requestedAmountWei: string
    issuedAt: number
  }
  /** Address that submitted (claimant or merchant, recovered server-side). */
  submittedBy: `0x${string}`
  /** Unix seconds when the server accepted the record. */
  submittedAt: number
  /** Chain id + verifier the record was verified against. */
  chainId: number
  verifier: `0x${string}`
}

const MAX_RECORDS = 2_000

const store = new Map<string, StoredEvidence>()

/** Look up a stored evidence record by lowercase evidence hash. */
export function getEvidence(evidenceHash: string): StoredEvidence | undefined {
  return store.get(evidenceHash.toLowerCase())
}

/**
 * Store an evidence record. Returns { ok: true } on first write; { ok: false,
 * reason } when the hash is already stored (immutable) or the store is full.
 */
export function putEvidence(
  evidenceHash: string,
  record: StoredEvidence,
): { ok: boolean; reason?: string } {
  const key = evidenceHash.toLowerCase()
  if (store.has(key)) {
    return { ok: false, reason: "Evidence for this hash is already stored and immutable." }
  }
  if (store.size >= MAX_RECORDS) {
    return { ok: false, reason: "Evidence store is full; retry later." }
  }
  store.set(key, record)
  return { ok: true }
}

/** Test-only: clear the store. Never called by a route. */
export function resetEvidenceStoreForTests(): void {
  store.clear()
}
