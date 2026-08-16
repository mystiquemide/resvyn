/*
 * REV-001 (round 3/4/5): server-owned evidence store.
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
 *  - RECOVERABLE (round 4/5): getEvidenceByClaim() lets the API answer
 *    "is this claim already attested?" after a reload. Reads initialize the
 *    store from disk (round 5: cold-start reads no longer skip persistence),
 *    writes are serialized so concurrent intakes cannot lose acknowledged
 *    records, and a corrupted/unreadable store FAILS CLOSED (no reads, no
 *    overwrites) instead of starting empty.
 */

import type { StoredEvidence } from "./evidenceTypes"

const MAX_RECORDS = 2_000

// The store path is resolved lazily so tests can point it elsewhere.
function storePath(): string {
  return process.env.RESVYN_EVIDENCE_STORE_PATH || "./data/evidence-store.json"
}

/**
 * Ensure the store has been loaded from disk. Called by every read AND write
 * (round 5: cold-start reads must not skip persistence initialization).
 *
 * If loading fails the store FAILS CLOSED: reads return nothing and writes
 * are refused, so a corrupted store can never be silently overwritten with
 * an empty map.
 */
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
    loadFailed = true
    console.error("[evidenceStore] FAILED to load persisted evidence; store is unavailable (fail closed):", e instanceof Error ? e.message : String(e))
  }
}

/**
 * Store an evidence record. DISK-FIRST (round 4): the record is written and
 * atomically renamed on disk before it is committed to memory. Writes are
 * SERIALIZED (round 5) so two concurrent intakes each persist the latest
 * state instead of one overwriting the other's acknowledged record.
 *
 * Returns { ok: false } with a code + reason when the hash is already stored
 * ("conflict", immutable), the store is full ("full"), the disk write failed
 * ("write_failed"), or the store failed to load ("unavailable") - in every
 * failure case nothing is stored and the caller can retry.
 */
export function putEvidence(
  evidenceHash: string,
  record: StoredEvidence,
): Promise<{ ok: true } | { ok: false; code: "conflict" | "full" | "write_failed" | "unavailable"; reason: string }> {
  // Serialize all writes through one promise chain.
  const run = writeChain.then(async () => {
    await initEvidenceStore()
    if (loadFailed) {
      return { ok: false, code: "unavailable", reason: "Evidence store is unavailable (failed to load); no records can be accepted." } as const
    }
    const key = evidenceHash.toLowerCase()
    if (store.has(key)) {
      return { ok: false, code: "conflict", reason: "Evidence for this hash is already stored and immutable." } as const
    }
    if (store.size >= MAX_RECORDS) {
      return { ok: false, code: "full", reason: "Evidence store is full; retry later." } as const
    }
    const next = new Map(store)
    next.set(key, record)
    try {
      const { persistStore } = await import("./evidenceFs")
      await persistStore(storePath(), Object.fromEntries(next))
    } catch (e) {
      console.error("[evidenceStore] disk write failed; record NOT stored:", e instanceof Error ? e.message : String(e))
      return { ok: false, code: "write_failed", reason: "Evidence store write failed; retry later." } as const
    }
    // Only now commit to memory.
    store.set(key, record)
    claimIndex.set(claimKey(record.coverageId, record.claimId), key)
    return { ok: true } as const
  })
  // Keep the chain alive for the next write even if this one rejects.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Look up a stored evidence record by lowercase evidence hash. */
export async function getEvidence(evidenceHash: string): Promise<StoredEvidence | undefined> {
  await initEvidenceStore()
  if (loadFailed) return undefined
  return store.get(evidenceHash.toLowerCase())
}

/**
 * REV-016/REV-017 round 4/5: look up a record by its claim binding, so the
 * API can answer "has this claim already attested?" for browser rehydration.
 */
export async function getEvidenceByClaim(coverageId: string, claimId: string): Promise<StoredEvidence | undefined> {
  await initEvidenceStore()
  if (loadFailed) return undefined
  const hash = claimIndex.get(claimKey(coverageId, claimId))
  return hash ? store.get(hash) : undefined
}

/**
 * REV-017 duplicate detection: the set of evidence hashes already attested
 * for claims OTHER than the excluded claim id. /api/evaluate seeds the
 * policy's seenEvidenceHashes with this, so the same public evidence hash
 * used by a second claim is rejected as DUPLICATE_EVIDENCE.
 */
export async function getSeenEvidenceHashes(excludeClaimId?: string): Promise<Set<string>> {
  await initEvidenceStore()
  const seen = new Set<string>()
  if (loadFailed) return seen
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
  // Keep the loaded flag set so tests never re-read the on-disk file (which
  // may hold records from an earlier test run).
  loaded = true
  loadFailed = false
}

/** Test-only: force the next access to re-run init (load-failure tests). */
export function __forceReinitForTests(): void {
  loaded = false
  loadFailed = false
}

function claimKey(coverageId: string, claimId: string): string {
  return `${coverageId}:${claimId}`
}

const store: Map<string, StoredEvidence> = new Map()
const claimIndex: Map<string, string> = new Map()
let loaded = false
let loadFailed = false
let writeChain: Promise<void> = Promise.resolve()
