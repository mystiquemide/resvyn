# Re-review fix record (REV-001 .. REV-015)

This file records how each finding from the review in `CODE_REVIEW.md`
(PR #1) was addressed, plus the round-2 re-audit findings on PR #2
(REV-001r2, REV-002r2, REV-005r2, REV-007r2, REV-009r2, REV-013r2, and the
Paymaster log item). Each entry lists the fix and its verification.

## High

### REV-001: Public evaluator endpoint signs caller-controlled eligibility — FIXED (round 2)

Round 1 introduced an EIP-191 evidence attestation signed by the claimant or
merchant, but the request body still carried the evidence fields the signer
chose. The re-audit correctly noted that this proved provenance, not truth:
the beneficiary still selected the facts that authorize payout.

Round 2 moves the facts OUT of the evaluate request entirely:

- `web/lib/evidenceContent.ts` (new): canonical, order-independent
  serialization of the evidence content and `evidenceContentHash(content)`.
  The claim must be opened with this hash, so the on-chain commitment
  verifiably commits to exactly the server-seen content.
- `web/app/api/evidence/route.ts` (new): authenticated intake. The claimant
  or merchant attests the CONTENT; the server requires the content to hash
  to the claim's ON-CHAIN evidence hash, the claim to be open and bound to
  the submitted coverage, and the signer to be claimant or merchant. The
  record is stored server-side, first-write-wins (immutable).
- `web/lib/evidenceStore.ts` (new): server-owned store keyed by the on-chain
  hash. Single-instance (documented), bounded, immutable.
- `web/app/api/evaluate/route.ts`: the request body now carries ONLY
  `{coverageId, claimId, signer, signature, timestamp}` — no evidence
  fields, no amount. The route loads the server-owned record bound to
  `claim.evidenceHash` and FAILS CLOSED (409, no signature) when no record
  exists. All signals and the payout amount are derived from the stored
  record + live chain state.
- `web/lib/evaluateAuth.ts`: split into `intakeMessage`/`verifyEvidenceIntake`
  and `evaluateMessage`/`verifyEvaluateAuthorization`. The evaluate message
  binds only chain/verifier/claim/coverage/timestamp.
- `web/components/AppConsole.tsx`: two-step flow — "Attest evidence to
  server" (POST /api/evidence) then "Evaluate" (POST /api/evaluate with
  references only). The claim is opened with `evidenceContentHash(content)`.

Contradictory submissions and settlement races are impossible: the store is
first-write-wins per on-chain hash, and evaluation reads the single stored
record.

Tests: `web/app/api/evaluate/route.test.ts` — intake refuses content that
does not commit to the on-chain hash, unauthorized signers, stale
attestations; stores claimant/merchant records; re-submission is refused
(409); evaluate fails closed without a record, refuses unauthorized or stale
authorizations, signs claimant/merchant-authorized evaluations, returns
policy REJECT for attested ineligible evidence, and fails closed on provider
outage.

### REV-002: Default app can create irreversible locked exposure on an obsolete signer instance — FIXED (round 2)

Round 1 gated writes on a non-proof address + `NEXT_PUBLIC_RESVYN_OPERATIONAL=1`,
but the gate never verified the EVALUATOR. The re-audit correctly noted a
misconfigured deployment could accept deposits and lock coverage while
returning signatures the contract can never settle.

Round 2 makes the gate exact (chain/address/on-chain-signer/server-signer):

- `web/app/api/evaluate/route.ts`: reads the contract's immutable
  `evaluatorSigner` and requires it to EXACTLY match the address derived from
  `RESVYN_EVALUATOR_KEY`. Mismatch returns 503 `evaluator_signer_mismatch`
  with no signature.
- `web/app/api/evidence/route.ts`: refuses intake for the archived proof
  instance.
- `web/lib/chain.ts`: `EXPECTED_EVALUATOR` +
  `evaluatorSignerMatches()` — the client renders read-only when the pinned
  expected signer does not match the live on-chain signer.
- `web/components/AppConsole.tsx`: `canWrite` requires the signer match;
  a dedicated "Evaluator signer mismatch (read-only)" gate is shown.

Tests: `route.test.ts` asserts 503 `evaluator_signer_mismatch` when the mock
contract's evaluator differs from the server key; `route.archived.test.ts`
asserts the archived instance is refused before any chain read.

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

### REV-005: Rate limiting trusts spoofable proxy headers and process-local state — FIXED (round 2)
- `web/lib/rateLimit.ts`: forwarding headers only trusted behind
  `RESVYN_TRUST_PROXY=1`. Round 2: (a) when identity is untrusted ("shared"),
  the per-client bucket is SKIPPED so one caller cannot exhaust an
  "everyone" allowance — abuse stays bounded by per-claim + global budgets;
  (b) budgets are checked client -> claim -> global BEFORE any consumption,
  so an already-blocked request never burns the global allowance for other
  clients; (c) hits are only recorded after every check passed.
- Both routes parse ids with `BigInt` BEFORE rate limiting, so "1", "01",
  and "+1" all map to the same canonical per-claim key.
- Tests: `web/lib/rateLimit.test.ts` — proxy trust, per-claim, global, no
  global burn on blocked requests, no shared client bucket, canonical keys.

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
node --test --import tsx parity/evaluator.parity.test.ts   # 6 passing

# Web
cd web && npm ci
npm run lint                                               # 0 errors
npm run typecheck                                          # clean
npm test                                                   # 37 passing
npm run build                                              # production build
npm audit --omit=dev                                       # 0 vulnerabilities
```

## Not changed (out of scope, documented)

- No contract, ABI, or deployment change to the recorded Mainnet proof
  instance; it remains frozen read-only.
- No browser E2E harness, no shared evaluator package, no multi-instance rate
  limit store — tracked as future work in CODE_REVIEW.md milestones.
- Submission-side actions (public URL, organizer form) cannot be fixed from
  the repository.
