# Resvyn Project State

## Project

- Repo: https://github.com/mystiquemide/resvyn (private)
- Audit PR: https://github.com/mystiquemide/resvyn/pull/2 (draft)
- Branch: `agent/fix-audit-findings`
- Status: PR #2 in draft; all 5 review rounds addressed; awaiting re-review of round-5 fixes
- Current head: 51b8ce9 (round-5 fixes)
- Last updated: 2026-08-16
- Contract: merchant-funded warranty reserve on BOT Chain. "No funded reserve, no valid coverage."

## Source of Truth Order

1. Repository state (git log, CI, live PR)
2. Executed verification evidence (test/lint/build/audit runs)
3. `REV_FIXES.md` (finding -> fix -> verification record)
4. `SECURITY.md` / `README.md` (trust model, evidence model, env)
5. This state file

## Execution Rules

1. Keep PR #2 in draft; do not merge until the current re-review passes.
2. Every fix must be backed by a re-run of the affected suite; record evidence in `REV_FIXES.md`.
3. Never commit credentials, keys, or credential-bearing URLs (use `[REDACTED]`).
4. Preserve contract behavior and existing test coverage when changing the web/evaluator architecture.
5. The archived Mainnet proof deployment stays read-only, always.
6. End every session with one exact next action.

## Current Status

### Completed

- PR #1 review: 4 High, 7 Medium, 4 Low findings (REV-001..REV-015) + packaging requirements
- Contract fixes: coverage expiry enforced + `expireCoverage()`, ABI + expiry tests (102 contract tests)
- Evaluator architecture: server-owned evidence store, two-step flow, claim-bound records, server-derived product/receipt verification, fail-closed provider behavior
- Deployment gate: exact chain/contract/on-chain-signer/server-signer agreement; pinned evaluator required for writes
- Rate limiting: per-client early, per-claim post-auth, global at signing; bounded buckets
- Evidence recovery: GET /api/evidence status endpoint, localStorage snapshot for pre-intake reload, 409 conflict recovery
- Durable storage: disk-first fail-closed persistence, serialized writes, cold-start init, corrupt-store fail-closed
- CI: contracts + web jobs green (102 contract, 7 parity, 54 web tests; typecheck, lint 0 errors, build warning-free, audit 0 vulnerabilities)
- Docs: README, SECURITY.md, REV_FIXES.md, LICENSE, CI workflow, .gitignore

### In Progress

- Round-5 re-review of head 51b8ce9 (reviewer last reviewed 913bfbd; 7 findings were fixed and pushed)

### Blocked

- Re-review sign-off: reviewer must re-run against head 51b8ce9
- Judge access: repository is private, no stable public product/proof URL (hackathon gate FAIL)
- Sponsor-native flow: Paymaster path not operational; BOT-chain receipts exist but the mechanism is portable EVM

### Not Started (hackathon must-fix list)

- Stable public /proof URL + judge-accessible repo copy
- One reproducible invalid-evidence -> no-payout demonstration (negative proof)
- Browser E2E: open -> attest -> evaluate -> resolve, reloads, signer mismatch, reverted txs
- README absolute links, exact receipts, trust limitations
- Demo recording: reserve lock, payout, over-cap rejection, replay rejection, invalid-evidence refusal

## Review History (PR #2)

| Round | Reviewed head | Findings | Status |
|---|---|---|---|
| 1 | 394c22f | REV-001 open, REV-002 partial, CI parity, REV-009 regression, REV-005 bypass, paymaster log, zod | Fixed in ef58d71 |
| 2 | ef58d71 | REV-001r3 claimant-controlled facts, REV-016 unstable commitments, REV-017 not claim-bound, REV-002r3 pin, persistence, global rate limit | Fixed in bb9a4d2 |
| 3 | bb9a4d2 | Recovery incomplete, persistence fails open, global after store, per-claim exhaustion, build tracing | Fixed in 913bfbd |
| 4 | 913bfbd | Pre-intake reload strand, cold-start reads, concurrent writes, GET exposure, load fail-open, 409 classification, bucket growth | Fixed in 51b8ce9 |
| 5 | 51b8ce9 | Pending re-review | - |

## Verification Evidence (head 51b8ce9, re-run 2026-08-16)

| Check | Result |
|---|---|
| `npx hardhat test` | 102 passing |
| `node --test --import tsx parity/evaluator.parity.test.ts` | 7 passing |
| `npm test` (web) | 54 passing (5 files) |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 4 warnings (pre-existing img/exhaustive-deps) |
| `npm run build` | production build, warning-free |
| `npm audit --omit=dev` | 0 vulnerabilities |
| GitHub CI (Contracts, Web) | both pass at exact head 51b8ce9 |

## Key Decisions

1. Evidence is server-owned: /api/evaluate accepts no evidence fields; all signals derived from the stored record bound to the on-chain hash.
2. Product/receipt match are derived server-side from on-chain coverage hashes; remaining flags are explicit self-attestations (repositioned docs).
3. Evidence store is disk-first, serialized, claim-bound, fail-closed (corrupt store -> unavailable, never overwritten).
4. Writes require pinned evaluator (client) + exact signer agreement (server).
5. Rate budgets: client early, claim post-auth, global at signing/write.
6. Browser snapshot persists to localStorage; server status endpoint rehydrates post-intake.
7. Keep PR #2 draft until re-review passes.

## Next Exact Action

Request re-review of PR #2 at head 51b8ce9. If it passes, move to the hackathon must-fix list: make the repo/proof publicly accessible, then package the invalid-evidence negative demo and record the demo video. If the re-review returns findings, fix them in order of severity and re-push to the same draft branch.

## Checkpoint Protocol

Update this file after every review round, fix push, CI outcome, deployment, or work session. Preserve history; append new entries.
