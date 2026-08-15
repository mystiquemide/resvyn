/*
 * REV-001 (round 3/4): server-owned evidence store.
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
 *  - DURABLE + FAIL-CLOSED (round 3/4): records are persisted to a JSON file
 *    (RESVYN_EVIDENCE_STORE_PATH, default ./data/evidence-store.json) with
 *    atomic replace BEFORE the in-memory write is committed. If the disk
 *    write fails, putEvidence returns an error and nothing is stored, so a
 *    restart can never silently lose a record that was acknowledged.
 *  - RECOVERABLE (round 4): getEvidenceByClaim() lets the API answer
 *    "is this claim already attested?" after a reload, so the browser flow
 *    can rehydrate instead of being stranded.
 */

import type { StoredEvidence } from "./evidenceTypes"

const MAX_RECORDS = 2_000

// The store path is resolved lazily so tests can point it elsewhere.
function storePath(): string {
  return process.env.RESVYN_EVIDENCE_STORE_PATH || "./data/evidence-store.json"
}

/** Lazy load from disk. Idempotent; safe to call on every request. */
export async function initEvidenceStore(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const { loadStore } = await import("./evidenceFs")
    const raw = await loadStore(storePath())
    for (const [k, v] of Object.entries(raw)) {
      const record = v as StoredEvidence
      store.set(k.toLowerCase(), record)
      claimIndex.set(claimKey(record.coverageId, record.claimId), k.toLowerCase())
    }
  } catch (e) {
    console.error("[evidenceStore] failed to load persisted evidence, starting empty:", e instanceof Error ? e.message : String(e))
  }
}

/**
 * Store an evidence record. DISK-FIRST (round 4): the record is written and
 * atomically renamed on disk before it is committed to memory. Returns
 * { ok: false } with a code + reason when the hash is already stored
 * ("conflict", immutable), the store is full ("full"), or the disk write
 * failed ("write_failed") - in every failure case nothing is stored and the
 * caller can retry.
 */
export async function putEvidence(
  evidenceHash: string,
  record: StoredEvidence,
): Promise<{ ok: true } | { ok: false; code: "conflict" | "full" | "write_failed"; reason: string }> {
  await initEvidenceStore()
  const key = evidenceHash.toLowerCase()
  if (store.has(key)) {
    return { ok: false, code: "conflict", reason: "Evidence for this hash is already stored and immutable." }
  }
  if (store.size >= MAX_RECORDS) {
    return { ok: false, code: "full", reason: "Evidence store is full; retry later." }
  }
  const next = new Map(store)
  next.set(key, record)
  try {
    const { persistStore } = await import("./evidenceFs")
    await persistStore(storePath(), Object.fromEntries(next))
  } catch (e) {
    console.error("[evidenceStore] disk write failed; record NOT stored:", e instanceof Error ? e.message : String(e))
    return { ok: false, code: "write_failed", reason: "Evidence store write failed; retry later." }
  }
  // Only now commit to memory.
  store.set(key, record)
  claimIndex.set(claimKey(record.coverageId, record.claimId), key)
  return { ok: true }
}

/** Look up a stored evidence record by lowercase evidence hash. */
export function getEvidence(evidenceHash: string): StoredEvidence | undefined {
  return store.get(evidenceHash.toLowerCase())
}

/**
 * REV-016/REV-017 round 4: look up a record by its claim binding, so the API
 * can answer "has this claim already attested?" for browser rehydration.
 */
export function getEvidenceByClaim(coverageId: string, claimId: string): StoredEvidence | undefined {
  const hash = claimIndex.get(claimKey(coverageId, claimId))
  return hash ? store.get(hash) : undefined
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

/** Test-only: clear the store (memory only; never called by a route). */
export function resetEvidenceStoreForTests(): void {
  store.clear()
  claimIndex.clear()
  loaded = true
}

function claimKey(coverageId: string, claimId: string): string {
  return `${coverageId}:${claimId}`
}

const store: Map<string, StoredEvidence> = new Map()
const claimIndex: Map<string, string> = new Map()
let loaded = false
