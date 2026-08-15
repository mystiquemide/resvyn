/*
 * REV-001 (round 3): server-owned evidence store.
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
 *  - CLAIM-BOUND (REV-017): every record also carries the claimId and
 *    coverageId it was attested for. /api/evaluate refuses to use a record
 *    whose claim binding differs from the claim being evaluated, so a second
 *    claim reusing the same public hash cannot borrow the first claim's
 *    record.
 *  - Immutable + first-write-wins: a hash can be stored only once, so
 *    contradictory submissions or a settlement race are impossible.
 *  - DURABLE (round 3): records are persisted to a JSON file
 *    (RESVYN_EVIDENCE_STORE_PATH, default ./data/evidence-store.json) with
 *    atomic replace, so a restart or cold start does not lose attested
 *    evidence. A multi-instance deployment must point both instances at a
 *    shared file volume or a shared store.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"

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

const MAX_RECORDS = 2_000

// Resolved once at module load so Turbopack/Next can trace the fs access to
// a fixed path instead of warning about dynamic filesystem access.
const STORE_PATH = process.env.RESVYN_EVIDENCE_STORE_PATH ||
  join(process.cwd(), "data", "evidence-store.json")

function loadFromDisk(): Map<string, StoredEvidence> {
  const m = new Map<string, StoredEvidence>()
  try {
    if (!existsSync(STORE_PATH)) return m
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Record<string, StoredEvidence>
    for (const [k, v] of Object.entries(raw)) m.set(k.toLowerCase(), v)
  } catch (e) {
    console.error("[evidenceStore] failed to load persisted evidence, starting empty:", e instanceof Error ? e.message : String(e))
  }
  return m
}

const store: Map<string, StoredEvidence> = loadFromDisk()

function persist(): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true })
    const tmp = `${STORE_PATH}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(store), null, 2))
    renameSync(tmp, STORE_PATH) // atomic replace
  } catch (e) {
    console.error("[evidenceStore] failed to persist evidence:", e instanceof Error ? e.message : String(e))
  }
}

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
  persist()
  return { ok: true }
}

/**
 * REV-017 duplicate detection: the set of evidence hashes already attested
 * for claims OTHER than the excluded claim id. /api/evaluate seeds the
 * policy's seenEvidenceHashes with this, so the same public evidence hash
 * used by a second claim is rejected as DUPLICATE_EVIDENCE.
 */
export function getSeenEvidenceHashes(excludeClaimId?: string): Set<string> {
  const seen = new Set<string>()
  for (const [hash, record] of store) {
    if (excludeClaimId === undefined || record.claimId !== excludeClaimId) {
      seen.add(hash)
    }
  }
  return seen
}

/** Test-only: clear the store. Never called by a route. */
export function resetEvidenceStoreForTests(): void {
  store.clear()
  try {
    if (existsSync(STORE_PATH)) renameSync(STORE_PATH, `${STORE_PATH}.bak-${Date.now()}`)
  } catch {
    /* best-effort */
  }
}
