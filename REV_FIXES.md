# Re-review fix record (REV-001 .. REV-015)

This file records how each finding from the review in `CODE_REVIEW.md`
(PR #1) was addressed, plus the round-2 re-audit findings on PR #2
(REV-001r2, REV-002r2, REV-005r2, REV-007r2, REV-009r2, REV-013r2, and the
Paymaster log item), the round-3 findings on head ef58d71 (REV-001r3,
REV-016, REV-017, REV-002r3, REV-005r3, durable evidence storage), the
round-4 findings on head bb9a4d2 (evidence recovery, fail-closed
persistence, budget ordering, anonymous per-claim exhaustion, build
tracing), and the round-5 findings on head 913bfbd (pre-intake reload
recovery, cold-start read init, concurrent-write safety, unauthenticated
GET exposure, load-failure fail-closed, 409 classification, bounded rate
limit buckets). Each entry lists the fix and its verification.

## High

### REV-001: Public evaluator endpoint signs caller-controlled eligibility — FIXED (round 3, unchanged in round 4)

Round 2 moved the facts OUT of the evaluate request into a server-owned
evidence store, but the claimant still chose the facts at intake. The round-3
re-audit correctly noted that this proves provenance, not truth, and that a
future issuedAt bypassed the staleness check.

Round 3 changes WHAT is verified, not just WHO signs:

- **Server-derived eligibility (REV-001r3):** the intake route now derives
  `productMatches` and `receiptMatches` SERVER-SIDE by comparing
  `noteHash(productNote)` / `noteHash(receiptNote)` against the coverage's
  on-chain `productHash` / `receiptHash` — the merchant committed those at
  issuance, so the comparison is independent of the claimant's assertions.
  The claimant's `productMatches` field was REMOVED from the evidence content
  entirely; the evaluate route uses `record.derived.productMatches &&
  record.derived.receiptMatches`. A product note that does not match the
  coverage hash yields a signed REJECT (PRODUCT_MISMATCH), not an approval.
- **Future-dated evidence rejected:** intake returns 400 `future_issued_at`
  when `issuedAt > now + 300s`, and the policy (web + scripts, parity-tested)
  rejects `issuedAt > asOf + 300` as STALE_CLAIM.
- **Repositioning:** README/SECURITY now position Resvyn as a
  **self-attestation scheme with server-side structural verification** — not
  independent AI evidence verification. The remaining flags
  (damageEligible, evidenceComplete, fileIntegrityOk) are explicitly labeled
  self-attestations.
- Tests: `route.test.ts` — future issuedAt refused, product-note mismatch
  derives `productMatches=false` and evaluates to REJECT/PRODUCT_MISMATCH,
  matching notes derive true and evaluate to APPROVE.

### REV-016 (round 3, new): Browser evidence commitments are not stable — FIXED
- `web/components/AppConsole.tsx`: the evidence content is now built ONCE
  when the claim is opened and the exact snapshot (content + hash + claimId +
  coverageId) is kept in `evidenceSnapshot` state. Attestation reuses that
  snapshot instead of rebuilding, so a one-second `issuedAt` drift can never
  change the hash between openClaim and /api/evidence.
- The snapshot is bound to the REAL opened claim id after the ClaimOpened
  event, and `evidenceAttested`/`signed` reset whenever the claim references
  or any evidence field changes.
- Attestation without a snapshot fails with a clear message ("Open the claim
  first").

### REV-017 (round 3, new): Evidence records are not claim-bound — FIXED
- `web/lib/evidenceStore.ts`: `StoredEvidence` now carries `claimId` and
  `coverageId`. `web/app/api/evaluate/route.ts` refuses
  `evidence_claim_mismatch` (409, no signature) when the record bound to the
  hash was attested for a different claim/coverage, so a second claim
  reusing the same public hash cannot borrow the first claim's record.
- Duplicate detection: `getSeenEvidenceHashes(claimId)` seeds the policy's
  `seenEvidenceHashes` with hashes attested for OTHER claims, so the same
  evidence hash across claims is rejected as DUPLICATE_EVIDENCE.
- Tests: claim-reuse refused with `evidence_claim_mismatch`; seen-hash set
  contains the other claim's hash.

### REV-002: Deployment gate — FIXED (round 3)
- Round 2 added the exact server-side gate (on-chain `evaluatorSigner` must
  equal the address derived from `RESVYN_EVALUATOR_KEY`). Round 3 closes the
  client gap: a pinned evaluator is now REQUIRED for writes —
  `evaluatorSignerMatches()` returns false when
  `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR` is unset, so deposits/issuance stay
  disabled until the operator pins the expected signer. The gate useMemo
  dependency array now includes `signerOk`.

### REV-016 round 4 (recovery): Evidence snapshot is recoverable after reload — FIXED (rounds 4/5)
- **Server-side rehydration:** `GET /api/evidence?coverageId&claimId`
  returns the stored record status (attested flag, hash, derived checks) for
  a claim. `AppConsole` queries it whenever the claim references change, so
  after a reload the panel re-enables Evaluate from the server-owned record
  instead of stranding the flow.
- **409 recovery:** when attestation returns `evidence_conflict` for the
  EXACT attested hash, the UI treats the claim as attested and enables
  Evaluate.
- **Pre-intake reload (round 5):** the exact snapshot committed at openClaim
  is persisted to localStorage keyed by
  `resvyn:evidence:<chain>:<verifier>:<coverageId>:<claimId>`, so a reload
  between openClaim and attestation still has the original content and can
  attest it (no stranded claim, no locked reserve).
- **Stable snapshot:** the evidence content is still built ONCE at claim
  opening (issuedAt fixed at snapshot time) and reused for attestation, so
  the on-chain hash and the attested content can never drift.
- Tests: `route.test.ts` — GET reports attested=false with no record,
  attested=true with hash/derived after intake, claim-bound lookup (same
  hash on a different claim reports unattested).

### REV-017: Evidence records are not claim-bound — FIXED (round 3, extended in rounds 4/5)
- Records carry `claimId`/`coverageId`; `/api/evaluate` refuses
  `evidence_claim_mismatch` for cross-claim reuse, and `getSeenEvidenceHashes`
  seeds the policy's duplicate-evidence set per claim.
- Round 4: `getEvidenceByClaim()` + the claim index make the store
  queryable by claim for rehydration.
- Round 5: reads are async and always initialize the store first, so a
  cold-start /api/evaluate sees persisted records without requiring a prior
  write.

### Persistence round 4 (fail-closed): an unwritable store never reports success — FIXED (rounds 4/5)
- `putEvidence` is DISK-FIRST: the record is written and atomically renamed
  on disk BEFORE the in-memory commit. A failed disk write returns
  `write_failed` and stores nothing; the route answers 503
  `evidence_store_failed` (retryable) instead of 200.
- Round 5: writes are SERIALIZED through a promise chain so two concurrent
  intakes cannot overwrite each other's acknowledged records; a store that
  FAILS TO LOAD (corrupt/missing) is unavailable — reads return nothing and
  writes are refused (503 `evidence_store_failed`), so a corrupt file is
  never silently replaced by an empty store.
- The filesystem half lives in `web/lib/evidenceFs.ts`, imported dynamically
  (store path stays runtime-configurable, no whole-project build tracing).
- Tests: 503 on unwritable store then successful retry; corrupt store file
  -> 503, file not overwritten, reads fail closed.

### REV-003: Coverage expiry is stored but never enforced or released — FIXED (round 1, unchanged)
- `contracts/WarrantyReserve.sol`: `openClaim` reverts `CoverageAlreadyExpired`
  when `block.timestamp >= cov.expiry`; new `expireCoverage()` permissionlessly
  expires an unused, past-expiry coverage exactly once (terminal `Expired`
  status), releasing the full lock; `CoverageExpired` event. Grace rule
  documented: a claim opened before expiry remains settleable.
- ABI updated in `web/lib/chain.ts`.
- Tests: `test/expiry.behavior.ts` (8 cases: boundary open, post-expiry open,
  pre-expiry expire rejection, single lock release + terminal status +
  withdraw, open-claim grace, nonexistent coverage).

### REV-004: Production web dependency tree has three High vulnerabilities — FIXED
- `web/package.json`: Next.js 16.2.9 → 16.3.1, eslint-config-next → 16.3.1.
- Verification below: `npm audit --omit=dev` passes with 0 findings.

## Medium

### REV-005: Rate limiting trusts spoofable proxy headers and process-local state — FIXED (round 3)
- `web/lib/rateLimit.ts`: forwarding headers only trusted behind
  `RESVYN_TRUST_PROXY=1`. Round 2: (a) untrusted identity ("shared") skips the
  per-client bucket so one caller cannot exhaust an "everyone" allowance;
  (b) budgets checked before any consumption. Round 3: the global budget is
  split into `consumeGlobalBudget()`, called ONLY at the signing/write point —
  an unauthenticated flood of syntactically valid requests with unique claim
  ids can no longer exhaust the global allowance for legitimate users.
- Both routes parse ids with `BigInt` BEFORE rate limiting, so "1", "01",
  and "+1" all map to the same canonical per-claim key.
- Tests: `web/lib/rateLimit.test.ts` — proxy trust, per-claim, global
  consumed only at signing, no global burn on blocked requests, no shared
  client bucket, canonical keys.

### REV-005r3 / persistence (round 3, new): Evidence persistence is not deployment-safe — FIXED (rounds 3/4)
- Round 3: records persist to a JSON file (`RESVYN_EVIDENCE_STORE_PATH`,
  default `./data/evidence-store.json`) with atomic replace and load-on-start.
- Round 4: persistence is FAIL-CLOSED (disk-first writes; a failed write
  returns 503 and stores nothing) and the store is recoverable by claim
  (GET /api/evidence). Multi-instance deployments must share the file volume
  or use a shared store.

### REV-005 round 4: Global capacity checked after evidence is stored — FIXED
- The evidence route now consumes the global budget BEFORE the immutable
  store write: a rate-limited intake stores nothing, so retrying works
  instead of hitting 409.
- Budget ordering is now: cheap per-client check early (client bucket only)
  -> authenticate/verify -> consumeClaimBudget -> consumeGlobalBudget ->
  write/sign. Claim and global budgets are never consumed by cheap or
  rejected requests.

### REV-005 round 4: Per-claim limits are anonymously exhaustible — FIXED
- The per-claim budget is consumed only AFTER the attestation/authorization
  verified, so invalid signatures can no longer burn a known claim's
  allowance. The old `checkRateLimit(client, claim)` is split into
  `checkClientLimit` (early), `consumeClaimBudget` (post-auth),
  `consumeGlobalBudget` (at signing/write).

### Build tracing (round 4, low): production build emitted filesystem warnings — FIXED
- The store's fs usage moved into `web/lib/evidenceFs.ts`, imported
  dynamically, so the runtime-configurable store path no longer makes
  Turbopack trace the whole project. Production build is warning-free.

### Unauthenticated GET exposure (round 5, high): raw evidence is not leaked — FIXED
- `GET /api/evidence` now returns only the attested flag, the evidence
  hash, and the derived summary (productMatches/receiptMatches) — never the
  raw content (product note, receipt note, damage description, amount).
  Browser rehydration needs only the flag; the content stays server-side
  (and in the claimant's localStorage snapshot).

### 409 classification (round 5, medium): unrelated 409s are not attestation success — FIXED
- The evidence route now distinguishes: `conflict` (immutable, already
  stored) -> 409 `evidence_conflict`; `full` (store capacity) -> 503
  `evidence_store_full`; `write_failed`/`unavailable` -> 503
  `evidence_store_failed`. The client treats ONLY a 409
  `evidence_conflict` whose `evidenceHash` equals the hash it attested as
  "already attested"; every other 409/503 is a real failure.

### Rate-limit bucket growth (round 5, medium): buckets are bounded — FIXED
- `web/lib/rateLimit.ts`: once the bucket map exceeds 10,000 entries,
  expired windows are swept before the next hit; an all-live pathological
  map drops the oldest half. The map can no longer grow without bounds.
- Test: 10,050 unique clients do not leak memory; expired keys are reusable.

### REV-006: Groq/provider failures fail open to APPROVE — FIXED
- `web/lib/groqBrain.ts`: any provider failure (HTTP, timeout, malformed,
  schema) throws `GroqProviderError`; the route returns an error and no
  signature. The deterministic policy remains the brain only when Groq is not
  configured.
- Tests: `web/lib/groqBrain.test.ts` now asserts refusal for 401, network
  error, malformed JSON, and schema failure; route test asserts 500 with no
  signature.

### REV-007: Lint and CI release gates are absent or broken — FIXED (round 2)
- `web/package.json`: `"lint": "eslint ."` (Next 16 removed `next lint`).
- `web/eslint.config.mjs` (new): ESLint 9 flat config from eslint-config-next.
- `.github/workflows/ci.yml` (new): contracts compile+test; web
  lint/typecheck/test/build/audit.
- Round 2: the evaluator parity test moved OUT of the web package into
  `parity/evaluator.parity.test.ts`, run by the ROOT CI job via
  `node --test --import tsx` (web CI installs only web/node_modules and can
  no longer resolve root sources; tsx declared as a root devDependency).
  Web CI's `tsc --noEmit` now passes and tests/build/audit execute.

### REV-008: Rehearsal can spend on an arbitrary chain and logs the full RPC URL — FIXED
- `scripts/rehearse.ts`: unknown chains abort before any key use or deploy;
  only 968, 677 (with explicit flag), and `RESVYN_ALLOW_CHAIN_ID`-listed
  chains are allowed. RPC URL is redacted (userinfo/query/hash stripped)
  before logging.

### REV-009: Every app refresh rescans all historical logs and performs sequential RPC reads — FIXED (round 2)
- `web/lib/chain.ts`: `DEPLOY_START_BLOCK` (env-overridable).
- `web/components/AppConsole.tsx`: log scan bounded to the deployment start
  block; per-record reads stay capped (12 coverage + 12 claim rows).
- Round 2: the round-1 counts-cache is REMOVED. Rows are always re-read on
  refresh because claim status/paidAmount change on settlement and coverage
  status changes on expiry without the counts changing — the cache returned
  stale state. Correctness now wins; reads remain bounded.

### REV-010: Contract-critical evaluator logic is duplicated between scripts and web — ADDRESSED
- `parity/evaluator.parity.test.ts` (new, root suite): signs the same
  fixtures through both adapters and compares exact decision fields, model
  version hash, decision expiry, and the resulting signature
  (byte-identical), covering approvals, rejects, cap boundaries, and
  mismatched hashes. Any future drift between the two implementations now
  fails CI. (Round 2: moved out of web/ so web CI no longer needs root
  sources.)

### REV-011: The signing route and browser settlement workflow have no integration or E2E coverage — FIXED (route)
- `web/app/api/evaluate/route.test.ts` + `route.archived.test.ts`: 10 tests
  covering auth, forgery, cross-claim, staleness, policy outcomes, archived
  gate, and provider fail-closed with mocked chain reads.
- Browser E2E remains out of scope (no browser harness in the repo); the
  AppConsole workflow is now wired and reachable (see REV-012) and covered by
  the route tests end to end.

## Low

### REV-012: AppConsole monolith with unreachable evaluator handlers — FIXED
- The "Evaluate and settle" panel now renders real controls on an operational
  deployment: coverage/claim ids, requested amount, evidence note, the four
  evidence flags, Evaluate (sign attestation) and Resolve buttons, plus the
  signed-decision card. Handlers `onEvaluate`/`onResolve` are reachable.
  Archived mode renders the static proof panel.

### REV-013: zod is imported by the web app but not declared directly — FIXED (round 2)
- `web/package.json`: `zod` added as a direct dependency.
- `package.json` (root): `zod` added as a direct devDependency because
  `scripts/evaluator/schema.ts` imports it (round 2).

### REV-014: Repository documentation and security policy are absent by construction — FIXED
- `.gitignore`: blanket `*.md`/`*.MD` ignore removed (only explicit local
  files ignored).
- `README.md`, `SECURITY.md`, `LICENSE` (MIT) added.

### REV-015: Root development tooling carries 11 unresolved Low audit findings — DOCUMENTED
- No upstream fix exists for the primary `elliptic` advisory; the findings
  are dev-only and the web production tree audits clean. Tracking entry added
  to `SECURITY.md` with owner and review cadence.

### REV-006r2 (re-audit Low): Paymaster URL logged without redaction — FIXED
- `scripts/rehearse.ts`: the `RESVYN_PAYMASTER_URL` log line now goes
  through `redactUrl()`, and the malformed-URL fallback no longer echoes any
  part of the input (returns `<unparseable url redacted>`), so credentials or
  tokens embedded in an operator URL can never reach logs.

## Verification (rerun locally)

```bash
# Contracts
npm ci && npx hardhat compile && npx hardhat test          # 102 passing

# Evaluator parity (root)
node --test --import tsx parity/evaluator.parity.test.ts   # 7 passing

# Web
cd web && npm ci
npm run lint                                               # 0 errors
npm run typecheck                                          # clean
npm test                                                   # 54 passing
npm run build                                              # production build, warning-free
npm audit --omit=dev                                       # 0 vulnerabilities
```

## Not changed (out of scope, documented)

- No contract, ABI, or deployment change to the recorded Mainnet proof
  instance; it remains frozen read-only.
- No browser E2E harness, no shared evaluator package, no multi-instance rate
  limit store — tracked as future work in CODE_REVIEW.md milestones.
- Submission-side actions (public URL, organizer form) cannot be fixed from
  the repository.
