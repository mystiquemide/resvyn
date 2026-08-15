# Code Review

## Review Metadata

- Project: Resvyn
- Review date: 2026-08-15
- Reviewer: Codex using universal-code-reviewer, code-review, and repo-audit
- Review target: https://github.com/mystiquemide/resvyn, branch main
- Base revision: 3b13656fe8d2ca688cd08fe17c1fe99a58d191ce (parent of the reviewed head)
- Head revision: 92368b1847636f54319dc297bd641ee3ac878b48
- Review mode: Full-repository baseline with security and release-readiness focus
- Secondary focus: Blockchain/payment authorization, AI evaluator trust boundaries, dependency supply chain, tests, operations, and maintainability
- Plan phase or checkpoint: Not available. No tracked PROJECT_PLAN.md or PROJECT_STATE.md exists.
- Files reviewed: Tracked Solidity, TypeScript, TSX, JavaScript, JSON, configuration, tests, and environment-example files, including callers and consumers of the contract and evaluator paths
- Files excluded: node_modules, web/.next, generated web/tsconfig.tsbuildinfo, and organizer-side submission records that are not public
- Environment: Linux checkout at /home/mide/hackathons/resvyn; GitHub and BOT Chain RPC access available; clean dependency reinstall was blocked by npm registry timeouts and resets
- Overall confidence: High for source-level and live-chain findings; Medium for browser/runtime behavior because no public deployment was available

## Verdict

**Changes required**

The repository is not ready for merge or release. Four High findings affect authorization, fund recoverability, lifecycle correctness, and production dependencies. The core contract accounting and signature checks are promising, but those strengths do not compensate for a public signing endpoint that trusts caller assertions and a default app that can create new locked positions on an immutable proof instance whose evaluator is documented as no longer active.

## Executive Summary

Overall health grade: **D**. Resvyn combines a Solidity reserve contract, a Next.js/Wagmi client, a server-side EIP-712 evaluator, and Hardhat/Vitest tests for a merchant-funded warranty flow. The contract has good baseline controls including immutable signer binding, EIP-712 domain checks, nonce replay protection, reentrancy protection, and effects-before-interactions payout accounting. The highest-risk defect is /api/evaluate: an unauthenticated caller supplies the eligibility booleans and requested amount that are then signed as settlement authority. The application source points by default at a proof contract whose immutable evaluator is explicitly described as no longer in use, while deposit and issuance controls remain enabled, so any deployed copy can lock real BOT without a supported settlement or cancellation path. Coverage expiry is stored but never enforced during claim opening or settlement, allowing post-expiry claims and indefinite locked exposure. The web production dependency tree reports three High vulnerabilities with a fix available in Next.js 16.3.1. The best opportunities are to make evidence authoritative, make coverage locks recoverable, and restore executable CI and integration evidence before adding more UI or model features.

## Repo Map

- Purpose: Merchant-funded warranty coverage on BOT Chain, where a merchant locks native BOT, a claimant opens one evidence-bound claim, and an off-chain evaluator signs an EIP-712 settlement decision.
- Apparent maturity: Hackathon prototype with a recorded Mainnet proof and a complete web application source tree, but no accessible public deployment found and no production governance, recoverability, or release gates.
- Runtime targets: BOT Chain Mainnet 677, BOT Chain Testnet 968, a Node.js Next.js server route, and browser wallets through Wagmi/Viem.

| Layer | Stack | Responsibility |
|---|---|---|
| Contract | Solidity 0.8.28, OpenZeppelin EIP712/ECDSA/ReentrancyGuard | Reserve accounting, coverage locks, claim state, signature verification, payout |
| Contract tooling | Hardhat 3.12, TypeScript 6, Viem | Compile/test, preflight, paymaster checks, rehearsal/deployment |
| Evaluator | TypeScript, Zod, optional Groq API | Typed policy, schema validation, EIP-712 decision construction and signing |
| Web application | Next.js 16.2.9, React 19, Wagmi, Viem, TanStack Query | Wallet connection, contract reads/writes, proof/reserve views, evaluator route |
| Tests | Hardhat/Viem behavior and invariant tests, Vitest | Contract transitions, evaluator policy/signing, paymaster parsing, Groq/rate-limit helpers |

Architecture sketch:

1. Merchant wallet -> AppConsole -> depositReserve / issueCoverage -> WarrantyReserve locks maxPayout.
2. Claimant wallet -> openClaim -> contract stores coverage ID, claimant, and evidence hash.
3. Browser -> /api/evaluate -> route reads live claim/coverage -> policy or Groq -> server evaluator key signs EIP-712 decision.
4. Any relayer -> resolveClaim -> contract validates signer/domain/nonce/bindings -> pays claimant or rejects -> releases full lock.

| Area | Role |
|---|---|
| contracts/ | WarrantyReserve and adversarial claimant/merchant mocks |
| scripts/evaluator/ | Original schema, policy, and signing implementation |
| scripts/ | Preflight, paymaster, and transaction-sending rehearsal tooling |
| test/ | Contract behavior, invariant, evaluator, integration, and paymaster tests |
| web/app/ | Next App Router pages and the public evaluator API |
| web/components/ | Wallet console, proof verifier, reserve lookup, and presentation |
| web/lib/ | Chain/ABI constants, copied evaluator, Groq adapter, rate limiting, formatting, and wallet config |

Surprises: the default live address is the archived proof instance; its evaluator is documented as no longer used while writes remain enabled. The signing route trusts browser-provided eligibility assertions. All Markdown is ignored, so the repository has no durable onboarding, plan, security, or deployment documentation.

## Scope and Limitations

- This was a full baseline review of the current main revision, not a diff-only approval.
- The repository has no tracked README, license, security guide, project plan, or project state file. Requirements were therefore inferred from contract comments, tests, environment documentation, and user-facing copy. The BR/FR/ADR identifiers in comments could not be checked against an approved source of truth.
- Web unit tests, strict TypeScript, and the production build were reproduced earlier in this review session. The Solidity suite could not start because the Hardhat executable was unavailable after dependency installation attempts.
- Live-chain state and all six recorded receipts were independently re-read from https://rpc.botchain.ai on 2026-08-15. A replay and an over-cap issuance were also simulated with eth_call; both reverted with the expected contract errors.
- No browser E2E, route-handler integration, accessibility, load, or multi-instance deployment test was available in the repository or executed here.
- The target checkout had no tracked changes. The build/type checks generated only the untracked web/tsconfig.tsbuildinfo inside the temporary review clone; no implementation code was modified.

## Requirements Reviewed

- Merchant reserve accounting: deposits, locked exposure, free reserve, withdrawal bounds, and payout rollback.
- Coverage issuance: claimant binding, maximum payout cap, expiry storage, and reserve locking.
- Claim lifecycle: claimant-only opening, evidence-hash binding, one claim per coverage, terminal settlement, and replay prevention.
- Evaluator trust boundary: server-side key handling, schema validation, EIP-712 field binding, model/provider failure behavior, and relay authorization.
- Web/API controls: input validation, authentication and authorization, rate limiting, error handling, chain selection, and user-visible disabled or recovery states.
- Release obligations: reproducible tests, lint/type/build gates, dependency hygiene, operational safety, documentation, and deployment recoverability.

## Verification Performed

| Check | Scope | Result | Evidence |
|---|---|---|---|
| Git target/status | Reviewed main revision | Pass | HEAD was 92368b1847636f54319dc297bd641ee3ac878b48 with no tracked changes when review began |
| npm test | web/ Vitest suite | Pass: 17/17 tests | Two test files passed in about one second |
| npx tsc --noEmit --incremental false | web/ | Pass | Strict TypeScript completed with exit 0 |
| npm run build | web/ Next production build | Pass | Next 16.2.9 compiled, type-checked, and generated all 11 routes |
| npm run lint | web/ | Fail | next lint is interpreted as a project named lint: invalid project directory |
| npm audit --omit=dev --json | web/ production dependencies | Fail: 3 High | High findings affect Next.js, nested PostCSS, and Sharp; npm reports Next.js 16.3.1 as the available fix |
| npm audit --omit=dev --json | Root package production dependencies | Pass: 0 | No root production vulnerabilities reported |
| npm audit --json | Root full dependency tree | Fail: 11 Low | Transitive elliptic/ethers/Hardhat tooling findings; no current fix for the primary advisory |
| npm test | Root Hardhat contract suite | Unavailable | Exit 127: hardhat: not found; prior install attempts also encountered the Hardhat EDR package download timeout |
| Secret-pattern scan | Tracked source excluding dependencies/build output | Pass with documented fixtures | No live credential found; matches were bogus test keys, key-handling code, or generated private keys |
| Direct JSON-RPC batch | BOT Chain Mainnet proof | Pass | Chain ID 677; deployed bytecode present; coverageCount 1; claimCount 1; evaluator 0xb1CB...455E; contract balance 0 |
| Receipt verification | Six recorded Mainnet transactions | Pass: 6/6 | Deploy, deposit, issue, open, resolve/pay, and withdraw receipts all exist with status 0x1 and expected events |
| Negative eth_call checks | Replay and reserve-cap enforcement | Pass: 2/2 | Replayed signed settlement reverted with selector 0x1fb09b80 (NonceAlreadyUsed); one-wei over-cap issuance reverted with selector 0x57532ab3 (InsufficientFreeReserve) |
| Clean dependency reinstall retry | Root and web | Unavailable | npm registry failed with ETIMEDOUT/ENOTCACHED/ECONNRESET; no rerun result was substituted for the earlier reproduced checks |
| Repository/CI/docs inventory | Tracked files | Finding | No tracked README.md, LICENSE, SECURITY.md, .github/workflows, or Markdown documentation; .gitignore excludes all Markdown |

## Audit Report

The detailed findings below are evidence-ranked and sorted by severity. This dimension index shows where each repository-audit concern is addressed; several findings span more than one dimension.

### Dimension Index

| Dimension | Findings |
|---|---|
| Architecture and design | REV-002, REV-003, REV-009, REV-010, REV-012 |
| Code quality | REV-010, REV-012, REV-013 |
| Security | REV-001, REV-004, REV-005, REV-006, REV-008 |
| Testing | REV-007, REV-011 |
| Performance | REV-005, REV-009 |
| Dependencies | REV-004, REV-013, REV-015 |
| DevEx and operations | REV-002, REV-007, REV-008 |
| Documentation | REV-014 |

## Findings Summary

| Severity | Count |
|---|---:|
| Blocker | 0 |
| Critical | 0 |
| High | 4 |
| Medium | 7 |
| Low | 4 |
| Nit | 0 |
| Positive | 5 |

## Blocking Findings

## [HIGH] REV-001: Public evaluator endpoint signs caller-controlled eligibility

- Category: Security / authorization / blockchain settlement
- Location: web/app/api/evaluate/route.ts:33-44, web/app/api/evaluate/route.ts:167-208, web/components/AppConsole.tsx:500-524, contracts/WarrantyReserve.sol:258-275
- Requirement or control: Server-side authorization and authoritative evidence; the evaluator signature must represent trusted claim evidence, not an untrusted browser assertion.
- Evidence: The route has no authentication or claimant/merchant authorization check. Its request schema accepts productMatches, damageEligible, evidenceComplete, fileIntegrityOk, and requestedAmountWei from the caller. Those values are copied into ClaimEvidence and passed to evaluateAndSign. With all booleans true and a positive amount at or below coverage.maxPayout, the deterministic policy returns APPROVE and the route signs it with RESVYN_EVALUATOR_KEY. The contract intentionally allows any relayer to submit a valid evaluator signature, so the caller need not be the claimant.
- Problem: The trust boundary validates shape but not provenance. A public caller can choose the facts that cause approval, while the server signs the result as if it came from an evaluator that inspected evidence.
- Impact: Any open claim can be turned into an approval for the requested amount by a caller who knows its public IDs. If the caller controls the claimant wallet, this enables self-approved payouts for unsupported damage; otherwise it still lets an unrelated party trigger settlement decisions and consume the merchant's locked exposure.
- Reproduction or failure scenario:

  POST /api/evaluate
  {
    "coverageId": 1,
    "claimId": 1,
    "evidence": {
      "productMatches": true,
      "damageEligible": true,
      "evidenceComplete": true,
      "fileIntegrityOk": true,
      "requestedAmountWei": "<any positive value at or below the cap>"
    }
  }

  For an open claim, this reaches the signing branch without proving that any evidence was uploaded, attested, or authorized by the claimant.
- Recommended correction: Make the API accept an authenticated evidence reference or a server-issued attestation, not raw eligibility assertions. Derive claim ownership and allowed amount server-side, require an authenticated claimant/merchant or an explicit evaluator workflow, and fail closed when provenance is absent. Keep the contract's signature checks as defense in depth rather than treating the signature as proof that browser input was trustworthy.
- Verification after correction: Add route-handler tests for unauthenticated requests, cross-claim requests, forged evidence flags, amount tampering, replay, and valid authenticated evidence. Assert that no signature is returned unless the server can retrieve a trusted evidence record bound to the exact on-chain evidence hash.
- Confidence: High
- Status: Open

## [HIGH] REV-002: Default app can create irreversible locked exposure on an obsolete signer instance

- Category: Blockchain funds safety / deployment operations
- Location: web/lib/chain.ts:241-260, web/components/AppConsole.tsx:778-848, web/components/AppConsole.tsx:867-870, web/app/terms/page.tsx:24-28, contracts/WarrantyReserve.sol:69-71
- Requirement or control: Users must not be invited to create a funded position unless the deployed contract has a supported evaluator, settlement path, and recovery path.
- Evidence: The default app address is the fixed Mainnet proof instance 0x414592d2313d233b673b1f97803c261355ccd996. The contract's evaluatorSigner is immutable and has no rotation or cancellation surface. The app copy says the instance is already settled and that its evaluator signer is no longer in use, while the deposit, issue coverage, and open claim controls remain enabled whenever a wallet is connected to chain 677. The terms page warns that BOT can be locked or paid out but does not prevent issuance.
- Problem: The application exposes state-changing controls against a contract it simultaneously describes as unable to settle new claims. Issuance increments locked exposure, and the contract has no expiry release or merchant cancellation function that can recover it.
- Impact: A user can deposit real BOT and issue a new coverage that remains locked indefinitely if the original evaluator key is unavailable. This is an avoidable loss-of-funds and support incident even when the user follows the UI as presented.
- Reproduction or failure scenario: Connect a wallet on BOT Mainnet, deposit reserve, and issue a coverage with a future expiry using the default address. The reserve's locked amount increases. The displayed evaluator warning does not disable the transaction. If no matching immutable signer can produce a decision, the user has no application-supported way to release that lock.
- Recommended correction: Immediately feature-gate all writes for archived/proof addresses and ship a deployment manifest that marks an instance operational only when its on-chain evaluator signer, server signer, chain, and contract address match. Deploy a fresh instance with a controlled evaluator before re-enabling issuance. For the existing instance, either recover the exact signer and settle/reject active claims or clearly freeze new issuance and document that already locked funds cannot be migrated by a new deployment.
- Verification after correction: Test the app with the proof address and a signer mismatch; deposit, issue, open, evaluate, and withdraw controls must be disabled before wallet prompts. Add a deployment smoke check that reads evaluatorSigner and fails startup when it differs from the configured operational signer.
- Confidence: High
- Status: Open

## [HIGH] REV-003: Coverage expiry is stored but never enforced or released

- Category: Smart-contract correctness / availability / funds recovery
- Location: contracts/WarrantyReserve.sol:183-210, contracts/WarrantyReserve.sol:228-255, contracts/WarrantyReserve.sol:272-355
- Requirement or control: A coverage expiry must bound claimability and must not leave reserve exposure permanently locked after the coverage window.
- Evidence: issueCoverage rejects only an expiry in the past and stores it. openClaim checks coverage status and claimant but never compares block.timestamp with cov.expiry. resolveClaim checks only the signed decision expiry, not the coverage expiry. No function expires, cancels, or unlocks an active coverage that receives no claim.
- Problem: The coverage timestamp is metadata rather than a lifecycle invariant. A claimant can open and settle after coverage expiry, and an unused coverage can retain its full maxPayout lock forever.
- Impact: Post-expiry payouts can violate product terms. More importantly, unused or abandoned coverage can make merchant reserve permanently unavailable, creating a liveness and funds-recovery failure.
- Reproduction or failure scenario: Issue coverage with an expiry, advance the chain beyond that timestamp, then call openClaim as the claimant. The function still succeeds. A valid evaluator decision can then settle the claim because only d.expiry is checked.
- Recommended correction: Define the lifecycle explicitly. At minimum, reject openClaim after coverage expiry and add a permissionless expireCoverage or merchant cancellation function that releases the lock exactly once. Decide whether an already-open claim has a grace period; enforce that rule in resolveClaim. Emit an expiry/cancellation event and preserve terminal accounting.
- Verification after correction: Add Hardhat tests for open-before-expiry, open-at-expiry boundary, open-after-expiry, expiry of an unused coverage, settlement during any declared grace period, repeated expiry calls, and reserve accounting after every transition.
- Confidence: High
- Status: Open

## [HIGH] REV-004: Production web dependency tree has three High vulnerabilities

- Category: Dependency supply chain / production security
- Location: web/package.json:12-30, web/package-lock.json:5729-5784, web/package-lock.json:6537-6543
- Requirement or control: Production dependencies must have no known High vulnerabilities before release, or a documented and approved exception with compensating controls.
- Evidence: The web app pins Next.js 16.2.9. npm audit --omit=dev --json reports three High vulnerability groups affecting Next.js, nested PostCSS, and Sharp, including App Router authorization bypass, SSRF/DoS advisories, arbitrary file disclosure in PostCSS, and inherited libvips vulnerabilities in Sharp. npm reports Next.js 16.3.1 as the available non-major fix.
- Problem: The production dependency set is below the audit fix level. The build succeeding does not establish that the deployed runtime is safe from published dependency defects.
- Impact: Depending on deployment configuration and reachable features, attackers may exploit framework request handling, SSRF, denial-of-service, source-map/file disclosure, or image-processing vulnerabilities.
- Reproduction or failure scenario: Run npm audit --omit=dev --json in web/. The command exits nonzero and reports three High vulnerability groups with Next.js 16.3.1 as the fix.
- Recommended correction: Upgrade Next.js and eslint-config-next to at least the audit-reported fixed version, regenerate and review web/package-lock.json, run the full web verification suite, and repeat npm audit --omit=dev. Review the resulting advisory reachability rather than suppressing the report.
- Verification after correction: The production audit reports zero High/Critical findings, the lockfile resolves the fixed Next/PostCSS/Sharp versions, and build, route tests, and deployment smoke tests pass.
- Confidence: High
- Status: Open

## Other Findings

### Security and AI

## [MEDIUM] REV-005: Rate limiting trusts spoofable proxy headers and process-local state

- Category: API abuse prevention / reliability
- Location: web/lib/rateLimit.ts:20-40, web/lib/rateLimit.ts:49-75
- Requirement or control: A public signing endpoint needs a trustworthy client identity and bounded, deployment-appropriate abuse control.
- Evidence: clientKeyFromRequest accepts the first x-forwarded-for value or x-real-ip directly. checkRateLimit stores every key in a process-local Map; cleanup runs only after the map reaches 10,000 entries. The file itself documents that multi-instance deployments require a shared store.
- Problem: Unless the hosting proxy strips and rewrites these headers, a caller can rotate arbitrary forwarded IP values to obtain fresh buckets. In a multi-instance or serverless deployment, each instance has an independent quota. Unique-key traffic also grows memory until the coarse sweep threshold.
- Impact: An attacker can bypass the intended signing-request cap, increase evaluator-key and RPC load, and amplify the authorization defect in REV-001.
- Reproduction or failure scenario: Send requests with a different first x-forwarded-for value each time. clientKeyFromRequest returns a new bucket for every value, so each request receives the full configured quota.
- Recommended correction: Use the platform's trusted request address or a signed proxy header, reject untrusted client-supplied forwarding headers, and move counters to a bounded shared store when more than one process can serve requests. Add per-claim, per-account, and global signing budgets.
- Verification after correction: Proxy integration tests prove forged headers do not change identity; multi-instance tests share counters; unique-key load tests remain within a defined memory bound.
- Confidence: High
- Status: Open

## [MEDIUM] REV-006: Groq/provider failures fail open to APPROVE

- Category: AI safety / financial decisioning
- Location: web/lib/groqBrain.ts:159-199, web/lib/groqBrain.test.ts:53-95
- Requirement or control: External model or provider failure must not silently authorize a financial payout unless the fallback policy is explicitly trusted and independently sourced.
- Evidence: The hard-signal gate returns APPROVE when the typed booleans and requested amount pass. Any Groq HTTP error, timeout, malformed JSON, or schema failure is caught and returns that gate decision. Tests explicitly expect APPROVE for a 401, network error, and malformed provider response.
- Problem: The fallback is described as safe, but it uses the same caller-supplied signals that the public route accepts. When the provider is unavailable, the system settles using an unverified client assertion rather than failing closed or requiring manual review.
- Impact: Provider outage, misconfiguration, or deliberate key removal becomes an approval path and compounds REV-001.
- Reproduction or failure scenario: Configure a bogus Groq key or force fetch to return 401 while all typed signals pass. groqBrain returns APPROVE, as asserted by the existing tests.
- Recommended correction: Fail closed to a non-signing/manual-review state for provider failures. If deterministic approval is intentionally retained, feed it only server-derived evidence and document the independent policy authority and risk acceptance.
- Verification after correction: Unit and route tests assert no signature is returned on provider timeout, HTTP error, malformed output, and schema failure; a separate test proves valid server-owned evidence can use the documented fallback if product policy approves it.
- Confidence: High
- Status: Open

### Operations and Release Gates

## [MEDIUM] REV-007: Lint and CI release gates are absent or broken

- Category: DevEx / release engineering
- Location: web/package.json:5-10; repository-wide absence of .github/workflows
- Requirement or control: Security-critical changes need reproducible lint, type, unit, contract, dependency, and build gates in CI.
- Evidence: The web script is "lint": "next lint"; with Next 16.2.9 this command fails as an invalid project-directory invocation. No tracked CI workflow exists. The root contract test command cannot run in the review checkout because the Hardhat binary is unavailable.
- Problem: A nominal lint command does not execute lint, and there is no repository-enforced pipeline that would catch this, dependency regressions, or contract test failures before merge.
- Impact: Future changes can bypass static analysis and release checks while the project presents a passing build as its primary evidence.
- Reproduction or failure scenario: Run npm run lint in web/. It exits 1 with "Invalid project directory" rather than evaluating source. Inspecting the repository shows no workflow that would detect this failure.
- Recommended correction: Configure ESLint 9 with a checked-in flat config and use eslint . (or the current supported Next integration). Add CI jobs for web lint/type/test/build/audit and root compile/test/invariant checks, with deterministic dependency installation and a documented Hardhat EDR cache or prerequisite.
- Verification after correction: A clean checkout runs the same commands in CI and locally; a deliberately failing lint/test change makes CI fail; the contract suite reports a real pass rather than an unavailable command.
- Confidence: High
- Status: Open

## [MEDIUM] REV-008: Rehearsal can spend on an arbitrary chain and logs the full RPC URL

- Category: Operational safety / secret hygiene
- Location: scripts/rehearse.ts:183-220
- Requirement or control: A transaction-sending rehearsal tool must fail closed on unknown networks and must not echo credentials embedded in operator URLs.
- Evidence: The script refuses Mainnet unless an explicit acknowledgement is set, but for every other unexpected chain it prints a note and continues, constructs a chain with that ID, deploys, funds, and sends transactions. It also prints rpcUrl verbatim.
- Problem: A typo, proxy, fork, or wrong network can receive a real deployment and funds. A URL containing basic-auth credentials, a bearer token, or sensitive query parameters can be copied into CI logs.
- Impact: Operator funds and proof records can be sent to an unintended chain; secrets may be exposed through logs and log aggregation.
- Reproduction or failure scenario: Point RESVYN_RPC_URL at any funded non-677/non-968 chain. The script prints a warning, logs the full URL, constructs that chain, and continues into deployment.
- Recommended correction: Allow only chain 968 and explicitly opted-in local development IDs; require a separate, narrowly scoped local flag for any other chain. Redact URL credentials and query strings before logging, and log only the hostname plus chain ID.
- Verification after correction: Tests cover unknown-chain rejection before key use or deployment, Mainnet acknowledgement, and URL redaction for credential-bearing URLs.
- Confidence: High
- Status: Open

### Architecture and Performance

## [MEDIUM] REV-009: Every app refresh rescans all historical logs and performs sequential RPC reads

- Category: Performance / availability
- Location: web/components/AppConsole.tsx:245-337
- Requirement or control: User-facing chain reads must be bounded, cancellable, and resilient to growing history and provider limits.
- Evidence: Each refresh reads up to 12 coverages and 12 claims, then calls getLogs from block 0 to latest and decodes the full result. The coverage loop performs two reads per item and the claim loop performs one read per item. The refresh is invoked from a React effect and after writes.
- Problem: Runtime cost grows with contract history and repeats on ordinary UI refreshes. A long-lived contract or slow RPC can make the app wait, hit provider limits, or hide current state behind a large historical response.
- Impact: Availability and responsiveness degrade as adoption grows; the same RPC pressure also competes with evaluator reads and can become an application-level denial-of-service vector.
- Reproduction or failure scenario: Refresh /app against a contract with substantial history. The client asks for all matching logs from block 0 and then issues the per-record reads again, regardless of what changed.
- Recommended correction: Bound event queries with a deployment start block and cursor, use a small indexed event/read model or multicall, paginate old records, cancel stale refreshes, and cache immutable coverage/claim data. Keep a short recent-event window for the session log.
- Verification after correction: Load tests with representative block history keep refresh latency and RPC calls within documented budgets; pagination and cancellation tests prove stale requests cannot overwrite newer state.
- Confidence: High
- Status: Open

## [MEDIUM] REV-010: Contract-critical evaluator logic is duplicated between scripts and web

- Category: Architecture / consistency
- Location: scripts/evaluator/schema.ts, scripts/evaluator/policy.ts, scripts/evaluator/service.ts:10-16, web/lib/evaluator.server.ts:9-21
- Requirement or control: The policy, schema, and EIP-712 binding used to sign money-moving decisions must have one authoritative implementation.
- Evidence: The web module explicitly describes itself as a faithful port of the scripts evaluator and redefines the schema, policy, types, binding, and signing flow. The script path and web path are separate source trees with separate imports and tests.
- Problem: A future fix can land in one evaluator and not the other. The current review found matching intent, but there is no compile-time single-source guarantee or parity test that prevents semantic drift.
- Impact: Rehearsal and production can make different decisions or encode different signed payloads; reviewers must audit two implementations whenever the contract format changes.
- Reproduction or failure scenario: Change a reason-code rule or typed-data field in scripts/evaluator only. The web build and web tests can still pass while production continues using the old copied rule.
- Recommended correction: Extract a shared evaluator package/module consumed by both entry points, generate or centralize contract ABI/type definitions, and add a parity test that signs the same fixture through both adapters and compares the exact decision bytes.
- Verification after correction: The scripts and web route import the same policy/schema/service implementation; parity tests cover approvals, rejects, cap boundaries, expiry, and model-version hashing.
- Confidence: High
- Status: Open

### Testing and Maintainability

## [MEDIUM] REV-011: The signing route and browser settlement workflow have no integration or E2E coverage

- Category: Testing / security evidence
- Location: web/app/api/evaluate/route.ts; web/components/AppConsole.tsx; existing tests limited to web/lib/groqBrain.test.ts and web/lib/rateLimit.test.ts
- Requirement or control: The money-moving API and user workflow need tests that exercise authentication, chain binding, errors, and transaction state transitions.
- Evidence: Web tests cover only the pure Groq and rate-limit modules. There is no route-handler test, wallet/browser E2E, or test that posts a request to /api/evaluate and submits the returned decision to a contract. The contract suite, which contains broad local behavior cases, was unavailable in this environment.
- Problem: The highest-risk trust boundary is tested only indirectly through pure functions. UI states for loading, signer mismatch, provider failure, reverted transactions, and archived deployments are not exercised end to end.
- Impact: A regression can restore caller-controlled approval, break EIP-712 serialization, or leave a transaction UI claiming success without a valid settlement while all current web tests remain green.
- Reproduction or failure scenario: Change route authorization or decision serialization and run npm test in web/. The two pure-module suites do not instantiate the route or browser workflow, so they can remain green.
- Recommended correction: Add route integration tests with mocked chain reads and signer recovery, Hardhat/viem settlement tests using the real ABI, and browser E2E for connect, network switch, disabled archived writes, deposit/issue/open, evaluator refusal, and confirmed/reverted transaction states.
- Verification after correction: CI executes these suites against a deterministic local chain and fails on forged evidence, wrong signer, expired decisions, provider outages, and UI state mismatches.
- Confidence: High
- Status: Open

## [LOW] REV-012: AppConsole is a 1,262-line monolith with unreachable evaluator handlers

- Category: Code quality / user workflow
- Location: web/components/AppConsole.tsx:500-583, web/components/AppConsole.tsx:850-904
- Requirement or control: User-facing actions should be reachable, maintainable, and consistent with the displayed operational state.
- Evidence: onEvaluate and onResolve are defined, but the "Evaluate and settle" panel contains only static proof data and a link to /proof; there is no button or form invoking either handler. The component contains reserve reads, transaction orchestration, evaluator parsing, log history, and all of the UI in one 1,262-line file.
- Problem: Settlement code is dead in the rendered workflow, while the UI still presents a settlement section. The monolithic component makes it difficult to reason about state and to test the dangerous paths independently.
- Impact: New claims cannot be settled through the shown app workflow, and future edits are likely to leave stale handlers or inconsistent disabled states.
- Reproduction or failure scenario: Render /app and inspect the "Evaluate and settle" panel. It exposes only static proof rows and a /proof link; source references to onEvaluate and onResolve occur only at their definitions.
- Recommended correction: Decide whether the app is proof-only or operational. Remove dead handlers from a proof-only view, or expose a tested settlement flow behind an operational deployment flag. Split chain reads, transaction actions, evaluator UI, and log presentation into focused modules.
- Verification after correction: Component tests demonstrate that every rendered action invokes a handler and that proof-only deployments render no write controls; module boundaries have direct tests.
- Confidence: High
- Status: Open

## [LOW] REV-013: zod is imported by the web app but not declared directly

- Category: Dependency hygiene / build reproducibility
- Location: web/lib/evaluator.server.ts:1-3, web/package.json:12-30, web/package-lock.json:8118-8128
- Requirement or control: Every runtime import must be a direct manifest dependency with a lockfile entry.
- Evidence: evaluator.server.ts imports zod, but web/package.json has no zod entry. The lockfile contains it through another dependency tree, so the current hoisted install builds.
- Problem: The package relies on transitive/hoisted dependency layout. A clean package-manager resolution, workspace layout, or upstream peer-dependency change can make the server route fail to install or bundle.
- Impact: Production builds can fail unexpectedly after an otherwise unrelated dependency update.
- Reproduction or failure scenario: Install the web package under a resolver that does not hoist the transitive zod package to the app root. The direct import has no manifest guarantee and can fail resolution.
- Recommended correction: Add zod as a direct dependency at the version used by the schema, regenerate the lockfile, and verify a clean install with lifecycle scripts disabled where possible.
- Verification after correction: A clean isolated install resolves zod from the web manifest and the web test/type/build suite passes.
- Confidence: High
- Status: Open

## [LOW] REV-014: Repository documentation and security policy are absent by construction

- Category: Documentation / project governance
- Location: .gitignore:38-45; repository-wide absence of README, LICENSE, SECURITY, and tracked Markdown
- Requirement or control: A financial/blockchain repository intended for judge or public review needs an onboarding path, deployment warnings, license, security reporting path, and durable architecture/operational decisions.
- Evidence: .gitignore excludes all .md and .MD files, and no tracked Markdown or CI documentation exists. Critical behavior is instead embedded in source comments and UI copy.
- Problem: Operators and users cannot reliably discover the supported deployment, evaluator-key lifecycle, recovery limitations, test commands, or vulnerability-reporting process. Local plan/state files cannot be reviewed or shared.
- Impact: Misconfiguration and unsafe use are more likely, and security findings cannot be communicated through a repository-native process.
- Reproduction or failure scenario: Clone the repository with access and list tracked Markdown, README, license, or security files; none are present, and adding a Markdown file is ignored by the blanket rule.
- Recommended correction: Track a concise README, deployment/runbook, SECURITY.md, LICENSE, and an architecture/decision record. Narrow the ignore rule to intentional local documents rather than all Markdown.
- Verification after correction: A new contributor can install, run tests, understand which contract is operational, and report a security issue from the repository alone.
- Confidence: High
- Status: Open

## [LOW] REV-015: Root development tooling carries 11 unresolved Low audit findings

- Category: Dependency supply chain / development environment
- Location: package.json:13-19; root lockfile dependency graph
- Requirement or control: Development dependencies should be monitored and isolated, especially where cryptographic tooling is involved.
- Evidence: Root npm audit --json reports 11 Low findings, including the transitive elliptic risky cryptographic primitive advisory through ethers/Hardhat verification tooling. npm reports no current fix for the primary elliptic advisory.
- Problem: These packages are development-only in the current manifest, but they execute in build/test/deployment environments and can affect operator workstations or CI runners.
- Impact: The risk is lower than a production dependency issue, but compromised or vulnerable tooling can expose CI secrets or influence deployment artifacts.
- Reproduction or failure scenario: Run npm audit --json at the repository root. It exits nonzero with 11 Low findings in the Hardhat/ethers dependency graph.
- Recommended correction: Keep the root toolchain isolated from production, track the advisory and upstream fixes, remove unused verification/ethers components if possible, and run installs with scripts disabled except for required native builds.
- Verification after correction: CI records the audit result and dependency-review policy; production installs remain free of these dev-only packages; the unresolved advisory has an owner and review date.
- Confidence: High
- Status: Open

## Positive Practices

- The Solidity contract uses immutable evaluator binding, EIP-712 domain and field checks, nonce consumption, terminal claim states, and explicit custom errors.
- resolveClaim updates accounting before the external payout and uses nonReentrant; a failed transfer reverts the whole transaction, preserving state.
- The evaluator schema is strict, constrains reason codes and amounts, and prevents malformed model output from being signed.
- The policy treats free text as advisory and tests prompt-injection resistance, rather than allowing arbitrary model text to alter typed gates.
- HTTP security headers, CSP restrictions, server-only key loading, input parsing, and client error sanitization are present; the secret scan found no live credentials.

## Security Review

The primary trust boundary is the path from browser JSON to the server-held evaluator key and then to the contract's resolveClaim function. Contract-side signature authenticity and replay checks are strong, but they authenticate the server's signature rather than the truth of the evidence that caused the server to sign. The API currently lets an unauthenticated caller supply that evidence, and Groq failures use the same fail-open path. Rate limiting is not a sufficient authorization control and is itself spoofable unless the hosting proxy is trusted.

The contract does not expose an upgrade or signer rotation path, which is a defensible simplification for a proof deployment but makes deployment configuration and recovery critical. No live credentials were found; documented bogus test keys and ephemeral-key generation are not secrets. The CSP and basic response headers are useful baseline controls, but they do not mitigate authorization, lifecycle, dependency, or RPC abuse findings.

## Test and Evidence Review

The pure web tests pass and cover policy hard gates, schema validation, provider fallback behavior, and rate-limit helper behavior. The contract test source is unusually broad, including wrong-domain decisions, replay, cap boundaries, payout rollback, and reentrancy cases, but the suite could not be executed in this environment. There are no route-handler tests, browser E2E tests, or deployment smoke tests for the signer/address relationship. Coverage-expiry behavior is absent from the contract tests, matching the implementation gap in REV-003.

Passing the production build proves compilation and static route generation, not the correctness of the money-moving workflow. The broken lint command and absent CI mean the repository currently has no enforced quality gate for these checks.

## Code Quality and Maintainability

Naming and custom errors are generally clear in the contract. The main maintainability risks are the 1,262-line AppConsole, duplicate evaluator implementations, direct transitive dependency use, and dead settlement handlers. These issues are not merely stylistic: they make security-critical behavior harder to test and increase the chance that scripts, web routes, and contract bindings drift apart.

## Performance and Reliability

The contract's state transitions are bounded and use atomic accounting. The web refresh path is not bounded by history: it replays all logs from block zero and repeats multiple reads after writes. The rate limiter is bounded only by an infrequent map sweep and is not suitable for a multi-instance deployment. No performance benchmark or production observability configuration was found.

## Compatibility and Operations

The web app hard-codes BOT Chain Mainnet chain 677 and a proof contract address, while the rehearsal tool supports testnet 968 and arbitrary unexpected chain IDs. The app's visible copy acknowledges that the proof evaluator is obsolete but leaves writes enabled. There is no tracked deployment manifest, migration/runbook, alerting, rollback procedure, or supported recovery path for locked exposure.

## Plan Conformance

No approved plan or state file is present in the reviewed revision, so plan conformance cannot be established. Source comments reference BR/FR/ADR identifiers and describe an intended Milestone 3 surface, but those comments are not an independently reviewable acceptance specification. The report therefore treats observable code, tests, and UI behavior as the source of truth and records the missing plan as a documentation/governance gap rather than assuming the comments are satisfied requirements.

## Improvement Strategy

| Theme | Target state | Principle |
|---|---|---|
| Authoritative settlement evidence | The server signs only evidence records or attestations it retrieved and authorized; browser input is a request to evaluate, never the evidence itself | Never let an untrusted actor define the facts used to authorize a financial action |
| Recoverable coverage lifecycle | Expiry, cancellation, and settlement transitions release locks exactly once and are explicit on-chain states | Every user-funded lock needs a bounded, testable recovery path |
| Deployment-aware operations | The app is write-enabled only for a manifest-verified chain/address/signer tuple; archived proof instances are read-only | Treat deployment configuration as part of the security boundary |
| Executable quality gates | CI runs lint, type, web tests, route/E2E tests, contract tests, build, and production audit on clean installs | A passing local build is not release evidence without reproducible gates |
| Single source of truth and bounded reads | Scripts and web import one evaluator package; chain reads use cursors, pagination, multicall, or an indexed cache | Reduce duplicated money-moving logic and unbounded RPC work |

### Trade-offs

- Do not add an upgradeable proxy solely to rescue the immutable proof instance; a fresh audited deployment with an explicit migration/freeze plan is safer for this prototype.
- Do not build multi-region infrastructure before deciding whether the evaluator is a public production service. If it is public, a shared rate-limit store and centralized evidence store become mandatory.
- Do not refactor the entire UI before the evaluator trust boundary and contract lifecycle are corrected. Split the monolith only enough to make those paths testable.
- Dev-only Low findings can be monitored temporarily if the production dependency tree is clean, but they need an owner because deployment tooling handles keys and artifacts.

### Definition of Done Signals

- No unauthenticated request can obtain an evaluator signature from caller-supplied eligibility fields.
- Expired/abandoned coverages have an on-chain, tested unlock path and reserve accounting remains invariant.
- The app refuses writes when the configured contract, chain, or evaluator signer is not the operational tuple.
- Web production audit reports zero High/Critical vulnerabilities and CI passes lint, type, unit, route, build, and contract checks.
- A deterministic local-chain E2E test covers the full deposit -> issue -> open -> evaluate -> resolve/reject flow and all failure states.
- Refresh RPC work is bounded and observable, and rate limiting works across all serving instances.

## Task Plan

### Milestone 0 - Safety Net

| ID | Task | Files/areas affected | Acceptance criteria | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|
| M0-1 | Add evaluator route trust-boundary regression tests | web/app/api/evaluate/route.ts, new route tests, evaluator fixtures | Forged booleans, amount tampering, unauthenticated calls, wrong claim IDs, and replay return no signature; valid server-owned fixture signs | M | Low | None |
| M0-2 | Restore deterministic CI gates | web/package.json, ESLint config, .github/workflows, root install docs | Clean checkout runs lint, type, web tests, build, audit, contract compile/test; intentional failures fail CI | M | Medium | Hardhat install/EDR prerequisite decision |
| M0-3 | Add lifecycle and deployment smoke fixtures | Contract tests, web deployment check, testnet rehearsal | Tests can assert signer/address mismatch, expiry boundaries, and lock release before production deployment | M | Medium | M0-1 |

### Milestone 1 - Critical Fixes

| ID | Task | Files/areas affected | Acceptance criteria | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|
| M1-1 | Replace caller-supplied evidence with authenticated authoritative evidence | API route, evidence persistence/attestation service, evaluator service, UI request flow | API derives evidence and allowed amount from a trusted record; no public caller can select approval signals; provider failures do not sign | L | High | M0-1 |
| M1-2 | Implement coverage expiry/cancellation and lock release | contracts/WarrantyReserve.sol, ABI, contract tests, UI status handling | Open/resolve behavior at expiry is specified; unused coverage can be expired once; reserve and events remain correct | L | High | M0-3 |
| M1-3 | Freeze the obsolete proof instance and deploy an operational instance | web/lib/chain.ts, deployment manifest/runbook, app feature flags, operator scripts | Proof address is read-only; operational address has a controlled signer; startup verifies chain/address/signer tuple | M | High | M0-3 |
| M1-4 | Upgrade production web dependencies | web/package.json, web/package-lock.json | Next/PostCSS/Sharp audit findings are fixed; build, route tests, and audit pass on a clean install | S | Medium | M0-2 |

### Milestone 2 - High-Leverage Improvements

| ID | Task | Files/areas affected | Acceptance criteria | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|
| M2-1 | Extract one shared evaluator package | scripts/evaluator/*, web/lib/evaluator.server.ts, ABI/type fixtures | Scripts and web use the same schema/policy/signing code; parity tests compare exact decisions and typed-data payloads | M | Medium | M1-1 |
| M2-2 | Replace spoofable in-memory limiting | web/lib/rateLimit.ts, proxy/deployment config | Trusted client identity, shared counters, per-claim/global budgets, and bounded memory are tested | M | Medium | M1-1 |
| M2-3 | Bound and cache chain reads | web/components/AppConsole.tsx, chain read helpers/indexer | No block-zero scan on every refresh; paginated/cached reads meet latency and RPC budgets | M | Medium | None |

### Milestone 3 - Quality and Polish

| ID | Task | Files/areas affected | Acceptance criteria | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|
| M3-1 | Add browser E2E and transaction-state coverage | AppConsole, Playwright/browser harness, local chain fixture | Connect, switch, disabled proof writes, success, revert, provider failure, and recovery states are verified | L | Medium | M0-2, M1-3 |
| M3-2 | Split AppConsole and remove dead settlement code | web/components/AppConsole.tsx and extracted modules | Every rendered action has a tested handler; proof-only and operational views are explicit | M | Low | M1-3 |
| M3-3 | Add repository documentation and direct dependencies | README, LICENSE, SECURITY.md, runbook, web/package.json | New contributor can run the project and understand signer, expiry, funds, and reporting paths; zod is direct | S | Low | M1-3 |
| M3-4 | Harden rehearsal and monitor dev-tool advisories | scripts/rehearse.ts, root dependency policy | Unknown chains abort, RPC logs are redacted, and unresolved Low advisories have owners and review dates | S | Low | M0-2 |

### Quick Wins

- Disable deposit, issue, and open controls whenever the configured address is the archived proof instance or the on-chain evaluator does not match the operational manifest.
- Upgrade Next.js to the audit-reported fixed release and rerun the production audit.
- Replace next lint with the supported ESLint command and add a minimal workflow that runs it.
- Declare zod directly in the web manifest.
- Reject unknown rehearsal chains and redact the RPC URL before logging.

### Top Three Implementation Sketches

1. **Authoritative evaluator flow.** Introduce a server-owned evidence record keyed by claim ID and evidence hash. The claimant upload/attestation path stores normalized signals and provenance; /api/evaluate authenticates the caller, reads that record, re-reads the live claim/cap, and signs only the derived decision. Keep the client request limited to a claim/evidence reference and make every missing, stale, or provider-failed state return a non-signing result. The main gotcha is preserving the contract's exact EIP-712 bytes while removing all browser-controlled decision fields.
2. **Recoverable coverage lifecycle.** Add an explicit terminal expiration/cancellation transition in the contract. Check coverage expiry in openClaim, define a documented grace rule for already-open claims, release the full lock exactly once, and emit an event that the UI/indexer can consume. Test timestamp boundaries and repeated calls on a local chain before deploying. The main gotcha is avoiding a path where expiry releases a lock and a later settlement releases it again.
3. **Operational deployment gate.** Publish a signed or checked-in manifest containing chain ID, contract address, evaluator address, deployment start block, and operational status. On app startup, read evaluatorSigner from the contract and compare it with the manifest; if any value differs, render a read-only proof view and reject all writes server- and client-side. Deploy a new instance only after the evaluator key custody and recovery plan are documented. The main gotcha is that a new deployment cannot unlock old exposure, so the old instance needs an explicit freeze/recovery decision.

## Open Questions

- Is the Mainnet proof address intentionally read-only, or is the product expected to support new merchant coverage on Mainnet now?
- Is the original evaluator private key recoverable and controlled by the current operator? If not, which active coverages are accepted as permanently stranded?
- What system is authoritative for product match, damage eligibility, file integrity, and evidence completeness?
- Should expiry prevent only new claims, or should it also reject already-open claims after a grace period?
- Will /api/evaluate run on one long-lived server or a multi-instance/serverless platform? This determines the minimum rate-limit and evidence-store design.
- What is the supported deployment, rollback, and incident-response process, and what license should govern the repository if it is shared publicly?

## Required Re-Review Scope

Re-review is required after REV-001 through REV-004 are addressed. The next review must inspect the updated API/evidence authority, contract lifecycle and deployment address, app write gating, dependency lockfile, and all affected tests. It must rerun web lint/type/unit/build, production and root audits, Hardhat compile/tests/invariants, route integration tests, and browser E2E. A testnet rehearsal may be used for operational verification; do not use real Mainnet funds as a review fixture.

## Recommended Next Action

Freeze public funding and issuance on the default proof contract, then fix the evaluator trust boundary and define the coverage recovery lifecycle. Once those changes are tested on a deterministic local chain and a fresh operational deployment is verified, repeat this review before enabling new Mainnet writes.

## Review Sources

- Repository: https://github.com/mystiquemide/resvyn
- Reviewed revision: 92368b1847636f54319dc297bd641ee3ac878b48
- Primary source files cited inline, especially contracts/WarrantyReserve.sol, web/app/api/evaluate/route.ts, web/lib/evaluator.server.ts, web/lib/groqBrain.ts, web/lib/rateLimit.ts, web/components/AppConsole.tsx, and scripts/rehearse.ts
- Verification commands and results recorded in the Verification Performed table
- BOT Chain Mainnet RPC: https://rpc.botchain.ai, independently queried on 2026-08-15
- npm audit advisory data for the reviewed lockfiles, including GHSA-6gpp-xcg3-4w24, GHSA-m99w-x7hq-7vfj, GHSA-89xv-2m56-2m9x, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, and GHSA-f88m-g3jw-g9cj
