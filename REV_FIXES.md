# Re-review fix record (REV-001 .. REV-015)

This file records how each finding from the review in `CODE_REVIEW.md`
(PR #1) was addressed, with the verification evidence for each. The review's
"Required Re-Review Scope" (REV-001..REV-004) is fully covered; Medium and
Low findings are also addressed unless noted.

## High

### REV-001: Public evaluator endpoint signs caller-controlled eligibility — FIXED
- `web/lib/evaluateAuth.ts` (new): EIP-191 evidence attestation. The caller
  must sign a canonical message binding chainId, verifier, coverageId,
  claimId, evidence hash, all four evidence flags, requested amount, and a
  timestamp.
- `web/app/api/evaluate/route.ts`: the route now (a) requires the attestation,
  (b) recovers the signer and requires it to be the on-chain claim claimant
  or coverage merchant, (c) rebuilds the message with the ON-CHAIN evidence
  hash so any tampered or cross-claim payload fails signature recovery, and
  (d) rejects stale attestations (>5 min). No signature is returned for any
  failure.
- Client: `web/components/AppConsole.tsx` signs the attestation with the
  wallet before calling the route.
- Tests: `web/app/api/evaluate/route.test.ts` — anonymous, cross-claim,
  tampered evidence, mismatched evidence hash, stale timestamp, valid
  claimant/merchant attestations, policy REJECT, and provider failure.

### REV-002: Default app can create irreversible locked exposure on an obsolete signer instance — FIXED
- `web/lib/chain.ts`: `isArchivedProofInstance()` + `isOperationalDeployment()`
  — writes require a non-proof `NEXT_PUBLIC_RESVYN_ADDRESS` AND
  `NEXT_PUBLIC_RESVYN_OPERATIONAL=1`.
- `web/components/AppConsole.tsx`: all write controls gated on the manifest;
  the archived proof instance renders a read-only banner and disabled
  actions; the evaluate panel is only functional on an operational
  deployment.
- `web/app/api/evaluate/route.ts`: server-side gate — refuses to sign for the
  archived proof instance (403), regardless of attestation validity.
- Tests: `web/app/api/evaluate/route.archived.test.ts`.

### REV-003: Coverage expiry is stored but never enforced or released — FIXED
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

### REV-005: Rate limiting trusts spoofable proxy headers and process-local state — FIXED
- `web/lib/rateLimit.ts`: forwarding headers are only trusted behind
  `RESVYN_TRUST_PROXY=1`; otherwise all callers share one bucket (spoofing
  buys nothing). Added per-claim and global budgets, plus a hard memory cap
  with oldest-key eviction and per-call sweeping.
- Route wires the per-claim key.
- Tests: `web/lib/rateLimit.test.ts` (proxy trust, per-claim, global, memory).

### REV-006: Groq/provider failures fail open to APPROVE — FIXED
- `web/lib/groqBrain.ts`: any provider failure (HTTP, timeout, malformed,
  schema) throws `GroqProviderError`; the route returns an error and no
  signature. The deterministic policy remains the brain only when Groq is not
  configured.
- Tests: `web/lib/groqBrain.test.ts` now asserts refusal for 401, network
  error, malformed JSON, and schema failure; route test asserts 500 with no
  signature.

### REV-007: Lint and CI release gates are absent or broken — FIXED
- `web/package.json`: `"lint": "eslint ."` (Next 16 removed `next lint`).
- `web/eslint.config.mjs` (new): ESLint 9 flat config from eslint-config-next.
- `.github/workflows/ci.yml` (new): contracts compile+test; web
  lint/typecheck/test/build/audit.

### REV-008: Rehearsal can spend on an arbitrary chain and logs the full RPC URL — FIXED
- `scripts/rehearse.ts`: unknown chains abort before any key use or deploy;
  only 968, 677 (with explicit flag), and `RESVYN_ALLOW_CHAIN_ID`-listed
  chains are allowed. RPC URL is redacted (userinfo/query/hash stripped)
  before logging.

### REV-009: Every app refresh rescans all historical logs and performs sequential RPC reads — FIXED
- `web/lib/chain.ts`: `DEPLOY_START_BLOCK` (env-overridable).
- `web/components/AppConsole.tsx`: log scan bounded to the deployment start
  block; per-record re-reads and the log scan are skipped entirely when
  coverage/claim counts are unchanged (cache via ref).

### REV-010: Contract-critical evaluator logic is duplicated between scripts and web — ADDRESSED
- Full single-package extraction is deferred (documented trade-off in
  CODE_REVIEW.md: "Do not refactor the entire UI before the evaluator trust
  boundary and contract lifecycle are corrected").
- `web/lib/evaluator.parity.test.ts` (new): signs the same fixtures through
  both adapters and compares exact decision fields, model version hash,
  decision expiry, and the resulting signature (byte-identical), covering
  approvals, rejects, cap boundaries, and mismatched hashes. Any future drift
  between the two implementations now fails CI.

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

### REV-013: zod is imported by the web app but not declared directly — FIXED
- `web/package.json`: `zod` added as a direct dependency.

### REV-014: Repository documentation and security policy are absent by construction — FIXED
- `.gitignore`: blanket `*.md`/`*.MD` ignore removed (only explicit local
  files ignored).
- `README.md`, `SECURITY.md`, `LICENSE` (MIT) added.

### REV-015: Root development tooling carries 11 unresolved Low audit findings — DOCUMENTED
- No upstream fix exists for the primary `elliptic` advisory; the findings
  are dev-only and the web production tree audits clean. Tracking entry added
  to `SECURITY.md` with owner and review cadence.

## Verification (rerun locally)

```bash
# Contracts
npm ci && npx hardhat compile && npx hardhat test          # 102 passing

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
