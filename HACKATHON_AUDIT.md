# Resvyn Hackathon Audit

## Audit Metadata

- Project: Resvyn
- Competition: BOT Chain Africa Builder Challenge 2026 / Africa Pioneer Builder Challenge - Nigeria
- Audit date: 2026-08-15
- Reviewed revision: `92368b1847636f54319dc297bd641ee3ac878b48`
- Review mode: Existing-project gap review, elite submission audit, and Six-Gate competitive review
- Skills applied: `elite-hackathon-audit`, `hackathon-gap-reviewer`, `universal-code-reviewer`, `code-review`, and `repo-audit`
- Implementation changes: None. This audit evaluates the current project and does not recommend a rebuild.

## Competition Baseline

Authoritative public sources reviewed:

- Event brief: https://luma.com/sd9re1ll
- Official announcement mirror: https://t.me/BOTChainNetwork/457
- Project submission form: https://docs.google.com/forms/d/e/1FAIpQLSfXWKeoYefaifKyAuiw4CygeqtV2Mmij5c6fZcfudPHRyStSQ/viewform
- BOT Chain EOA Paymaster documentation referenced by the project: https://dev-docs.botchain.ai/docs/Developers/eoa-paymaster/

Confirmed competition facts:

| Item | Confirmed requirement |
|---|---|
| Build sprint | August 1-13, 2026 |
| Submission deadline | August 13, 2026, 11:59 PM WAT |
| Demo Day | August 15, 2026 |
| Technical review | August 15-20, 2026 |
| Mainnet | Deployment on BOT Chain Mainnet is mandatory |
| Product access | A working, user-accessible product or demo is mandatory |
| Deployment proof | Deployment information must be valid and publicly verifiable |
| Sponsor integration | The project must demonstrate meaningful BOT Chain integration |
| Priority areas | AI and RWA receive higher evaluation priority |
| Judging dimensions | Overall quality, functionality, BOT Chain integration, innovation, user value, and long-term potential |
| Explicit disqualification risk | Concepts, inaccessible demos, standalone repositories, or contracts alone do not qualify |

The official form is now closed. Whether Resvyn was submitted before the deadline, and which URLs were submitted, cannot be verified from the repository or public competition pages.

## Repository And Submission Evidence

Facts observed on 2026-08-15:

- The GitHub repository is private.
- Repository description and homepage are empty.
- No GitHub deployments are recorded and no GitHub Pages site exists.
- `resvyn.app` does not resolve in DNS.
- No accessible live product URL, submission page, or demo video was found.
- No tracked README, LICENSE, SECURITY guide, screenshots, submission brief, or other Markdown documentation exists.
- No tracked original hackathon brief, saved submission response, or previous reviewer report exists in the project; official organizer sources were used for the competition baseline.
- `.gitignore:43-45` ignores every Markdown file.
- All 67 tracked files at the reviewed revision were inventoried; core contract, evaluator, rehearsal, Paymaster, web, proof, configuration, and test paths received direct inspection.
- A real BOT Chain Mainnet contract and transaction history do exist and were independently verified.

This creates a critical distinction: the implementation has genuine Mainnet evidence, but the currently discoverable submission surface does not satisfy the competition's access requirements.

# Executive Verdict

**BUILD BUT CUT SCOPE**

Resvyn has a competitive core mechanism and a real Mainnet proof. The winning material is the reserve invariant, signed claim settlement, and direct on-chain evidence. The project should not be rebuilt. It should be reduced to one judge path: show that coverage cannot exist without funded capacity, show a bounded claim payout, and show the contract reject an attempted violation.

The project is not currently finalist-ready because no public live URL or public repository surface can be verified, the evaluator signs caller-controlled eligibility facts, and the default write UI targets an archived proof instance whose evaluator is described as inactive. Those are not cosmetic gaps. One can cause disqualification; the others undermine the central technical claim.

# What Already Works

- The contract is deployed on BOT Chain Mainnet at `0x414592d2313d233b673b1f97803c261355ccd996`.
- Direct RPC reads confirmed chain ID 677, deployed bytecode, evaluator binding, one coverage, one claim, and zero final contract balance.
- Six recorded Mainnet transactions all have successful receipts: deploy, reserve deposit, coverage issuance, claim opening, signed resolution/payment, and reserve withdrawal.
- The contract enforces reserve capacity before issuance at `contracts/WarrantyReserve.sol:194-196`.
- EIP-712 decisions bind chain, verifier, claim, coverage, claimant, evidence hash, amount, result, model version, expiry, and nonce at `contracts/WarrantyReserve.sol:272-355`.
- Replay prevention and terminal settlement are implemented, and a replayed decision was independently confirmed to revert through `eth_call`.
- The Mainnet proof UI re-reads live state and receipts rather than merely printing screenshots (`web/lib/proofEngine.ts:30-183`).
- The simulated walkthrough is honest about being simulated (`web/app/demo/page.tsx:19-39`).
- The landing-page message already contains the strongest invariant: "No funded reserve and no valid coverage."

# Highest Priority Problems

| Rank | Issue | Why it hurts judging | Exact fix | Expected impact |
|---:|---|---|---|---|
| 1 | No verified user-accessible product or demo URL | This is an explicit eligibility condition; an inaccessible demo can be rejected without technical scoring | Confirm the exact submitted URL immediately. If organizer rules permit updates, deploy the current web app to a stable public URL and send the corrected link through the organizer-approved channel | Prevents avoidable disqualification |
| 2 | Submission status is unknown and the official form is closed | A strong project that was not submitted cannot enter technical review | Locate the form confirmation/email and submitted fields. If absent, contact organizers; do not assume a post-deadline repository push substitutes for submission | Establishes whether further work can affect the result |
| 3 | `/api/evaluate` signs caller-selected approval facts | A technical judge can show that the "AI verification" is not authoritative because the browser supplies the facts that cause payout | Accept only a claim/evidence reference, authenticate the workflow, retrieve server-owned evidence bound to the on-chain hash, derive the amount server-side, and fail closed | Restores credibility of the central AI settlement claim |
| 4 | Default write flow targets an archived proof signer | A judge or user can lock real BOT in an instance that the UI says no longer has an active evaluator | Make the proof address read-only. Enable writes only for a chain/address/signer tuple verified as operational | Removes a live loss-of-funds and demo risk |
| 5 | No judge-facing README or submission proof package | Judges and automated reviewers cannot find the pitch, live URL, architecture, contract, transactions, tests, or known limitations | Track one concise README with a 30-second proof block, direct links, architecture, run steps, and honest status | Converts existing evidence into judge-usable evidence |
| 6 | Coverage expiry never changes behavior or releases the lock | Technical review can invalidate the warranty lifecycle and funds-recovery story | Reject post-expiry claim opening and add a one-time expiry/cancellation transition that releases unused exposure | Closes a core correctness and merchant-funds gap |

# Normal Hackathon Gap Review

## 1. Problem Quality

Score: **8/10**

The problem is real and easy to state: merchants make warranty promises without proving they have funds reserved to honor them. Buyers have little reason to trust an unfunded promise. The project turns that trust problem into an observable capacity rule.

The pain is strongest for small merchants, repairs, electronics, and informal commerce where warranty enforcement is weak. The repository does not provide user research, merchant commitments, or existing users, so the pain is credible but not independently validated.

Best problem statement:

> A warranty is only credible when its maximum payout is already reserved and cannot be withdrawn.

## 2. Sponsor Integration

Assessment: **Useful and operationally load-bearing, but architecturally replaceable.**

The current contract, balances, events, receipts, and proof reader depend on BOT Chain Mainnet. Removing BOT Chain from the current deployment destroys the working proof and all live state. That is meaningful integration.

However, the mechanism uses standard Solidity, EIP-712, native-token transfers, JSON-RPC, Wagmi, and Viem. It could be redeployed to another EVM chain with small configuration changes. The EOA Paymaster client is implemented and tested, but it is inert unless `RESVYN_PAYMASTER_URL` is supplied; the source explicitly says no public chain-677 endpoint was available (`scripts/paymaster.ts:26-30`). It must not be presented as an operational sponsor feature.

Smallest sponsor-depth improvement: integrate an actual BOT Chain EOA Paymaster endpoint into the claimant's `openClaim` path, show `pm_isSponsorable` state, and capture the sponsor-side transaction result. Do this only if BOT Chain provides a real endpoint during technical review.

## 3. Originality

Score: **6/10**

Escrow, insurance reserves, warranty contracts, and AI claim evaluation are common hackathon patterns. Twenty competent teams could independently propose "AI warranty claims on-chain."

The less generic mechanism is not the AI label. It is the accounting invariant: every issued policy immediately consumes funded reserve capacity equal to its maximum payout, and the merchant cannot withdraw that committed capacity. That is the differentiator to lead with.

Strategic angle:

> Resvyn is proof-of-capacity for warranties, not another insurance marketplace.

## 4. Judge Experience

A judge with three minutes can understand the project only with a guided path. The current repository alone does not provide that path.

Attention-loss points:

1. There is no public URL to open.
2. The repository is private and has no README.
3. The landing page delays the strongest evidence behind several sections.
4. `/demo` is simulated, so it cannot be the final proof.
5. `/proof` contains strong evidence but a dense state grid and six-row transaction table require narration.
6. The live app exposes merchant, claimant, evaluator, proof, and reserve concepts before the central invariant is fully established.
7. The AI evidence provenance is unclear and collapses under source inspection.
8. Paymaster code can be mistaken for a live BOT-specific integration even though it is not active.

The judge path should start at Mainnet proof, not at a marketing page or wallet setup.

## 5. Demo Review

The current simulated walkthrough has eight steps. It is clear, but too long for the only judge story and cannot substitute for live evidence.

Recommended sequence using current working functionality:

| Time | Scene | What happens | Judge emotion |
|---:|---|---|---|
| 0:00-0:12 | Problem | "Most warranties are unfunded promises. Resvyn makes capacity provable." | Immediate recognition |
| 0:12-0:30 | Action | Show 0.005 BOT deposited and 0.001 BOT locked when coverage is issued | "The promise is actually backed" |
| 0:30-0:50 | Sponsor mechanism | Open the BOT Mainnet contract and successful `CoverageIssued` / `ClaimPaid` receipts | Technical confidence |
| 0:50-1:08 | Result | Show claim #1 approved, 0.001 BOT paid, and reserve reconciled to zero | Closure |
| 1:08-1:25 | Negative case | Re-run the over-cap call and show `InsufficientFreeReserve`; optionally replay the signed decision and show `NonceAlreadyUsed` | Trust through enforcement |
| 1:25-1:35 | Finish | "No funded reserve, no valid coverage." | Memorability |

## 6. README Review

Current result: **Missing.**

There is no tracked README because all Markdown is ignored. This is one of the highest-return fixes because the project already has the evidence a strong README needs.

Delete or avoid:

- Long market essays.
- Generic AI and Web3 claims.
- Unverified Paymaster claims.
- A large roadmap.
- Repeating landing-page copy.

Expand:

- One-sentence invariant.
- Live URL and proof URL.
- Mainnet contract and exact receipts.
- Architecture and trust boundary.
- Reproducible positive and negative verification.
- Known limitations, especially archived signer status and evaluator authority.

## 7. Technical Review

The full evidence-ranked engineering review is in `CODE_REVIEW.md`. Verdict: **Changes required**, grade **D**, with 4 High, 7 Medium, and 4 Low findings.

Material hackathon findings:

- High: public evaluator route signs caller-controlled eligibility (`web/app/api/evaluate/route.ts:33-44`, `167-208`).
- High: default app can lock real BOT on an obsolete immutable signer deployment (`web/lib/chain.ts:241-260`, `web/components/AppConsole.tsx:778-870`).
- High: expiry is stored but never enforced or released (`contracts/WarrantyReserve.sol:183-210`, `228-355`).
- High: the web production tree reports three High dependency vulnerabilities.
- Medium: provider failures can fall back to APPROVE using the same untrusted signals (`web/lib/groqBrain.ts:159-199`).
- Medium: no route integration or browser end-to-end coverage exists for the money-moving workflow.
- Positive: contract-side EIP-712 field binding, replay protection, effects-before-interactions accounting, and reentrancy protection are strong.

## 8. Contract And Specification Review

Decisions that must be locked before more product code:

- What authoritative system determines `productMatches`, `damageEligible`, `evidenceComplete`, and `fileIntegrityOk`?
- Who may request evaluation, and who may trigger settlement?
- What happens when the evaluator provider is unavailable or returns malformed output?
- Does coverage expiry block only new claims, or also settlement after a grace period?
- Who can expire or cancel unused coverage, and when is locked exposure released?
- Is the proof deployment permanently read-only?
- Which chain/address/evaluator tuple is operational?
- Is signer rotation intentionally a new deployment, and how are old positions handled?
- Which event or artifact proves a failed enforcement path to judges?
- Is EOA Paymaster integration an actual submission feature or deferred research?

## 9. Proof Review

| Important claim | Required proof | Current evidence | Competitive quality |
|---|---|---|---|
| Coverage cannot exceed funded capacity | Contract source plus a reproducible rejected call | Source check and live `eth_call` revert with `InsufficientFreeReserve` | Strong mechanism, weak packaging |
| Merchant funds were deposited | Mainnet receipt and event | Successful deposit receipt and `ReserveDeposited` event | Strong |
| Coverage locked a maximum payout | Mainnet receipt, coverage state, reserve accounting | Successful issue receipt and `CoverageIssued` event | Strong |
| AI-signed decision paid the claimant | Decision artifact, recovered signer, Mainnet receipt | `ClaimPaid` receipt and immutable evaluator address; raw decision is recoverable from transaction calldata | Strong but not explained in docs |
| A decision cannot be replayed | Reproducible failed call or failed transaction | Live `eth_call` replay reverted with `NonceAlreadyUsed`; no mined failed transaction | Moderate |
| Product is usable | Public URL and reproducible user flow | Source exists; no public URL found | Failing |
| BOT-specific integration is meaningful | Live BOT state plus sponsor-native feature | Mainnet deployment and native BOT movement; Paymaster is non-operational | Moderate |

Proof competitors would struggle to fake: the complete six-transaction Mainnet lifecycle plus current state reconciliation to zero and a live replay/over-cap rejection against the deployed contract.

## 10. Automated Judge Review

Likely automated penalties:

- Repository is private.
- No README or documentation index.
- Empty repository description and homepage.
- No detected deployment or live URL.
- No screenshots or demo video.
- All Markdown ignored.
- Broken lint command.
- No CI workflow.
- High production dependency vulnerabilities.
- Unsupported or ambiguous "AI verified" claims.
- Paymaster source may be read as aspirational rather than operational.
- No submission metadata or judging-criteria mapping.
- No license.
- No explicit setup path for contract and web packages.

## 11. Feature Audit

| Feature | Decision | Reason |
|---|---|---|
| Merchant reserve deposit and accounting | KEEP | Foundation of the invariant |
| Coverage issuance with full max-payout lock | KEEP | Strongest differentiating mechanism |
| Claim opening bound to claimant and evidence hash | KEEP | Required bridge from warranty to settlement |
| EIP-712 bounded settlement | KEEP | Technically credible and already proven on Mainnet |
| Mainnet proof reader and receipt reconciliation | KEEP | Best judge-facing asset |
| Negative reserve-cap and replay checks | KEEP | Turns trust claim into visible enforcement |
| Eight-step simulated walkthrough | SIMPLIFY | Reduce to five story beats; retain a clear simulated label |
| General-purpose live write console on proof address | DEFER | Unsafe until an operational signer/deployment is available |
| Groq prose/brain emphasis | SIMPLIFY | Keep strict typed decisioning; do not make provider branding the pitch |
| EOA Paymaster path | DEFER | No operational endpoint or sponsor-side proof exists |
| FAQ, privacy, and terms pages | SIMPLIFY | Necessary for a product, but not part of the judge demo |
| Additional product categories, multi-chain, tokenomics | CUT | They dilute the invariant and do not close a judging gate |

## 12. Deliverables Review

### README

Must contain the invariant, live URL, 30-second proof, contract/transaction links, architecture, trust model, run/test steps, and known limitations.

### Demo Video

One 90-second video: problem, reserve lock, BOT Mainnet receipt, claim payout, negative rejection, final invariant. Include captions and show the browser URL.

### Submission Form

Must contain the exact public product URL, public proof URL, Mainnet contract, repository or judge-access link, 90-second video, one-line pitch, track selection, and team contact. Current submitted values are unknown.

### GitHub Repository

Must have README, description, homepage, license, screenshots, architecture, exact commands, proof links, and an explicit archived/read-only status for the proof deployment.

### Landing Page

First viewport should state the problem, invariant, and direct "Verify Mainnet proof" action. Marketing sections should not precede the proof during judging.

### Social Announcement

One short post: invariant, 15-second proof clip, BOT Mainnet contract, live URL, and competition tag. Do not lead with generic "AI-powered warranty" language.

## 13. Execution Plan

The deadline has passed. This plan applies only during the August 15-20 technical-review window and only where organizer rules permit updates. Do not silently replace submitted artifacts if post-deadline changes are prohibited.

| Date | Critical work | Backup/evidence task |
|---|---|---|
| Aug 15 | Confirm submission receipt and exact URLs; restore or establish the public demo; make proof deployment read-only | Send organizer-approved correction only if permitted |
| Aug 16 | Track README and proof package; record 90-second demo; set repository description/homepage and judge access | Export screenshots and a static proof PDF/video backup |
| Aug 17 | Fix evaluator evidence authority or disable public signing; make provider failure non-signing | Publish an explicit trust-model limitation if a safe fix cannot be completed |
| Aug 18 | Add expiry/unlock lifecycle, tests, and a fresh operational deployment if live writes are required | Keep proof-only mode if deployment confidence is insufficient |
| Aug 19 | Upgrade vulnerable production dependencies; restore lint/CI; rehearse the exact 90-second flow | Prepare explorer links and local video in case RPC/UI fails |
| Aug 20 | Verify every submitted link from a logged-out browser and freeze the presentation surface | Keep a one-page judge brief with all proof links |

# Elite Submission Audit

## Product And Feature Audit

The product has one high-quality mechanism surrounded by more surface area than judging requires. Reserve accounting, coverage locking, claim settlement, and proof should define the submission. The generic live console, extended landing page, broad AI language, and dormant Paymaster path increase explanation cost.

Main product risk: the current user-facing product source suggests an operational warranty service, while the default signer instance is effectively an archived proof and the coverage lifecycle has no expiry recovery.

## Code And Architecture Audit

Architecture is coherent at a prototype level: contract, evaluator, rehearsal scripts, web app, and proof verifier. The key structural weaknesses are duplicated evaluator logic, a 1,262-line `AppConsole`, and no authoritative evidence store. The full architecture map and remediation milestones are in `CODE_REVIEW.md`.

## UX And Design Audit

The UI is visually deliberate, responsive in source, and unusually honest about the simulated demo. The highest UX problem is conceptual, not cosmetic: users can see proof-only warnings while write controls remain available. A judge should never have to distinguish simulated, historical proof, and operational product states without explicit mode separation.

Recommended modes:

- Proof mode: read-only, no wallet required, all evidence visible.
- Demo mode: clearly simulated, compressed story.
- Operational mode: shown only for a verified current deployment and signer.

## Performance And Reliability Audit

- Every app refresh scans logs from block zero and performs sequential record reads (`web/components/AppConsole.tsx:245-337`).
- The rate limiter is process-local and trusts forwarding headers (`web/lib/rateLimit.ts:20-75`).
- No public deployment exists to test availability, cold starts, RPC CORS, or mobile performance.
- The proof verifier gracefully marks transport failures instead of falsely passing them, which is a good reliability property.

## Security And Technical Debt Audit

The settlement signature is cryptographically strong but semantically weak because its input facts are caller-controlled. This is the highest technical credibility risk. Additional release risks are the archived signer target, missing expiry recovery, fail-open provider behavior, High dependency vulnerabilities, and absent route/E2E tests.

## Submission Page Audit

No submitted page or saved form response was found. The official form is closed. A submission cannot be reconstructed from GitHub metadata because description/homepage are empty and the repository is private.

Status: **Unverifiable and potentially disqualifying.**

## Repository Audit

The source tree is substantial and includes contracts, tests, rehearsal scripts, a web app, and Mainnet proof data. The repository presentation is poor for judges: no README, no license, no CI, no screenshots, no release notes, no live link, and a blanket Markdown ignore rule.

## Competitive Positioning Audit

Current positioning: "merchant-funded warranty reserve with bounded AI settlement."

Winning positioning:

> Resvyn proves every warranty's maximum payout is funded before the warranty can exist.

The AI is a settlement component. BOT Chain is the public execution and evidence layer. The reserve invariant is the product.

## Hackathon Rubric Scoring

| Category | Score / 10 | Reason |
|---|---:|---|
| Problem quality | 8 | Concrete trust and solvency problem |
| Functionality | 7 | Full Mainnet lifecycle exists; operational app path is incomplete/unsafe |
| BOT Chain integration | 6 | Genuine Mainnet use, but standard EVM mechanism and no live Paymaster |
| Innovation | 6 | Reserve-capacity invariant is memorable; warranty/AI pattern is familiar |
| User value | 7 | Clear buyer trust and merchant accountability value; no user validation |
| Technical quality | 5 | Strong contract controls offset by evaluator authority and lifecycle defects |
| Presentation/evidence | 4 | Excellent raw chain evidence, but no accessible delivery surface or README |
| Long-term potential | 6 | Useful primitive, but governance, evidence authority, expiry, and operations are unresolved |

Total: **49/80 (6.1/10)**

## Presentation Readiness Audit

Current state: **Not ready for an unguided judge review.**

The project can support a strong 90-second presentation, but the presenter needs a stable public proof page, direct explorer links, and a prepared negative-case result. Wallet setup, live funding, or an evaluator API call should not be required during the first demonstration.

## Reality Check

1. Would a judge understand the value in ten seconds? Only if the invariant is spoken first.
2. Can a judge verify the central claim today? Yes through direct chain queries, but not through a discovered public submission surface.
3. Is BOT Chain essential to the mechanism? Essential to the current proof, replaceable in the architecture.
4. Does the negative path visibly enforce the promise? The contract does; the current judge packaging only partially exposes it.
5. Is the project ready to win now? No. Eligibility/access, evaluator authority, and proof packaging can still prevent placement.

# Decisions That Must Be Locked Before More Code

- The proof deployment is read-only and must never accept new funded positions through the app.
- A single operational chain/address/evaluator tuple is the source of truth.
- Browser-provided booleans are not authoritative evidence.
- Provider failure returns no signature.
- Coverage expiry has an explicit on-chain release rule.
- The submission leads with the reserve invariant, not with Groq or generic AI.
- Paymaster is either demonstrated against a real endpoint or omitted from all claims.
- The first judge link opens proof directly without wallet setup.

# Demo Plan

## 90-Second Judge Script

| Timestamp | Screen/action | Spoken line | Intended emotion |
|---:|---|---|---|
| 0:00-0:10 | Mainnet proof header | "Most warranties are promises with no money behind them." | Recognition |
| 0:10-0:22 | Coverage and reserve state | "Resvyn will not issue coverage unless its full maximum payout is already free in the merchant reserve." | Clarity |
| 0:22-0:38 | Deposit and issue receipts | "These are the real BOT Mainnet deposit and coverage transactions." | Confidence |
| 0:38-0:57 | Claim and payout receipt | "The claim is bound to one buyer and evidence hash. A bounded EIP-712 decision paid 0.001 BOT directly." | Technical trust |
| 0:57-1:13 | Replay/over-cap rejection | "Try to over-issue or replay the payment and the contract rejects it." | Safety |
| 1:13-1:25 | Reconciled reserve | "The buyer was paid, the remaining reserve was withdrawn, and nothing was stranded." | Closure |
| 1:25-1:30 | Invariant | "No funded reserve, no valid coverage." | Memorability |

Demo backups:

- Local screen recording of the same proof page.
- Direct BOTScan links for all six receipts.
- A terminal command or compact script that re-runs the two `eth_call` failures.
- One screenshot showing chain ID, contract, evaluator, coverage, claim, and zero balance.

# README Blueprint

1. `# Resvyn`
2. One-line pitch: "Fund the warranty before you issue it."
3. Status banner: Mainnet proof, proof deployment read-only, operational status.
4. 30-second proof: live URL, proof URL, contract, payout transaction, negative-check command.
5. Winning invariant: "No funded reserve, no valid coverage."
6. How it works: deposit -> lock -> claim -> signed decision -> pay/reject -> release.
7. Why BOT Chain: Mainnet execution, native BOT reserve, public receipts, optional EOA Paymaster status stated honestly.
8. Architecture diagram: browser, evaluator, BOT Mainnet contract.
9. Mainnet evidence table: all six transactions with purpose and outcome.
10. Security/trust model: evaluator authority, immutable signer, replay, cap, expiry limitation/status.
11. Run locally: root and `web/` commands, required environment variables.
12. Verification: tests, type check, build, negative checks, known unavailable checks.
13. Known limitations: archived proof signer, current operational deployment, evidence provenance, Paymaster availability.
14. License and security reporting.

# Submission Checklist

| Requirement | Status | Evidence/action |
|---|---|---|
| Submitted before Aug 13 11:59 PM WAT | UNKNOWN | Find confirmation or contact organizer |
| BOT Chain Mainnet deployment | PASS | Contract and six receipts independently verified |
| Working user-accessible product/demo | FAIL / NOT FOUND | Publish or recover the exact submitted URL |
| Publicly verifiable deployment information | BORDERLINE | Chain data is public; discovery package is missing |
| Meaningful BOT Chain integration | PASS WITH CAVEAT | Native BOT lifecycle is real; architecture is portable |
| AI/RWA priority fit | PASS WITH CAVEAT | RWA warranty use case; AI authority currently weak |
| Repository accessible to judges | FAIL / UNKNOWN | Repository is private; grant access or make public if rules permit |
| README and setup | FAIL | Track the blueprint above |
| Demo video | NOT FOUND | Record the 90-second script |
| Screenshots/architecture | FAIL | Add one proof screenshot and one architecture diagram |
| Contract/transaction links | IMPLEMENTED, NOT PACKAGED | Put them at the top of README/submission |
| Reproducible negative path | BORDERLINE | Live calls work; create one-click/scripted proof |
| No duplicate/eligibility conflict | UNKNOWN | Confirm form response and project history |

# Competitor Advantage Analysis

Typical teams are likely to outperform Resvyn in three visible ways:

- They will have a public one-click demo and a public README even if their mechanism is shallower.
- They may use a BOT-specific service such as an operational Paymaster, making sponsor necessity easier to defend.
- They may show a live failed transaction or sponsor dashboard state instead of explaining a simulated rejection.

Resvyn can surpass them by making its real Mainnet lifecycle and reserve invariant visible in under 30 seconds. It should not try to surpass them through more features.

# Final Strategic Edge

Lead with a live solvency challenge: ask the judge to choose any payout above the free reserve, execute a read-only simulation, and show the contract reject it. Then show the successful `ClaimPaid` receipt. This pairs a real success with a real failure and makes the invariant harder to dismiss as marketing.

# Six-Gate Competitive Review

## 1. Novelty

**Result: BORDERLINE**

Could 20 competent contestants arrive at substantially the same idea? Yes, if the idea is framed as "AI warranty claims on-chain" or "decentralized insurance." Those are predictable readings of an AI/RWA blockchain brief.

The actual reserve mechanism is more distinctive: issuing coverage consumes fully funded capacity equal to the immutable maximum payout, and that capacity cannot be withdrawn while exposed. That is a strong implementation detail, but it is not technically exotic and could be recreated with standard escrow accounting.

The weakness is primarily positioning, not the entire concept. The concept becomes more memorable when framed as warranty proof-of-capacity rather than an AI insurance app.

## 2. Judge Fit

| Judging criterion | What the judge wants | What Resvyn demonstrates | Evidence strength | Remaining gap |
|---|---|---|---|---|
| Overall quality | Coherent, polished, credible product | Designed web app, contract, evaluator, proof reader, broad tests | Medium | No accessible deployment, docs, CI, or safe operational mode |
| Functionality | Working end-to-end behavior | Six-step Mainnet lifecycle including payout and withdrawal | Strong on-chain | Public product flow is unavailable; live evaluator UI is incomplete/unsafe |
| BOT Chain integration | Meaningful sponsor use | Chain 677 contract, native BOT reserve, events, receipts, live RPC proof | Strong operationally | Mechanism is portable; Paymaster is not operational |
| Innovation | A memorable mechanism, not a clone | Fully collateralized per-policy capacity plus bounded signed settlement | Medium | Generic AI warranty framing hides the differentiator |
| User value | Clear benefit to real users | Buyer trust and merchant accountability | Medium | No user research, usage, merchant pilot, or validation |
| Long-term potential | Plausible expansion and sustainability | Reusable warranty reserve primitive | Medium-low | Evidence authority, expiry, governance, operations, and recovery unresolved |
| AI/RWA priority | Real application of AI and real-world workflows | Physical-product warranty claims and typed AI-assisted decisions | Medium | Caller-controlled evidence undermines meaningful AI evaluation |
| Eligibility/access | Mainnet plus working user-accessible demo | Mainnet passes | Weak/failing | No accessible live URL found; repo private; form closed |

**Result: FAIL**

The project fits the competition thematically and technically, but the current discoverable submission fails the explicit user-accessible product requirement. This competition-specific eligibility gap outweighs being a generally good prototype.

## 3. Sponsor Necessity

Sponsor deletion test on the current implementation:

- Remove BOT Chain Mainnet and the deployed contract, balances, events, receipts, proof page, explorer links, and transaction history stop working.
- The current central proof therefore depends on BOT Chain.
- The contract and app logic remain standard EVM and can be moved to another chain by changing chain configuration and redeploying.
- The EOA Paymaster implementation is not active without an external endpoint and has no sponsor-side receipt.

Classification: **Useful but replaceable.**

**Result: BORDERLINE**

Smallest architectural change that makes sponsor technology harder to remove: make the claimant's live claim-opening path use BOT Chain's EOA Paymaster, display the sponsor policy/result, and include the sponsored transaction in the proof timeline. This requires a real BOT endpoint; a mocked or dormant client does not count.

## 4. Winning Invariant

Resvyn's equivalent is:

> **No funded reserve, no valid coverage.**

The rule is enforced at issuance: `maxPayout` must be less than or equal to free reserve. Coverage immediately locks that capacity, and merchant withdrawal cannot consume locked exposure.

**Result: PASS**

This is concise, demonstrable, and memorable. Current marketing sometimes buries it beneath AI and warranty language, but the mechanism itself is strong.

## 5. 30-Second Proof

### CLAIMED

- Every warranty is backed by a real reserve.
- AI evaluates evidence and signs a bounded decision.
- The contract pays the buyer directly.
- Replay and over-issuance are blocked.
- The full flow ran on BOT Chain Mainnet.
- BOT Chain EOA Paymaster can enable gasless claims.

### IMPLEMENTED

- Native BOT reserve accounting and per-policy maximum payout locks.
- Claim opening bound to claimant and evidence hash.
- EIP-712 decision verification and direct payout/rejection.
- Nonce replay protection and reserve-cap rejection.
- Mainnet proof reader with live state/receipt reconciliation.
- Paymaster client and unit tests, gated behind an endpoint.

### VERIFIED

- Deployed bytecode at the recorded Mainnet address.
- Chain ID 677.
- Immutable evaluator address matches the recorded evaluator.
- `coverageCount = 1`, `claimCount = 1`, contract balance `0`.
- Six successful transaction receipts with expected lifecycle events.
- Replayed signed settlement rejects with `NonceAlreadyUsed` through `eth_call`.
- Over-cap issuance rejects with `InsufficientFreeReserve` through `eth_call`.
- No operational Paymaster endpoint or sponsored transaction was verified.
- No public live product URL was verified.

What a skeptical judge can verify in approximately 30 seconds if given one direct link: open the `ClaimPaid` transaction, confirm the contract/claimant/value event, then open the contract proof page or run the over-cap simulation. The raw evidence exists, but no currently accessible public surface packages that action.

**Result: BORDERLINE**

Exact proof to create: a stable public `/proof` URL whose first viewport shows contract, payout receipt, current reconciled state, and one live negative check, plus a 30-second screen recording as backup.

## 6. Demo Compression

Shortest current-functionality demo:

1. Problem: unfunded warranties are promises.
2. Action: show deposit and coverage lock from the recorded Mainnet run.
3. Sponsor mechanism: show BOT Mainnet contract and `CoverageIssued` / `ClaimPaid` receipts.
4. Result: buyer paid 0.001 BOT; merchant reclaimed 0.004 BOT; final reserve zero.
5. Proof: run over-cap and replay `eth_call` rejections.

This fits in 75-90 seconds without new product functionality. It requires either a deployed proof page or a prepared local/browser recording.

**Result: BORDERLINE**

The value is compressible, but the current delivery is split across a simulated demo, a proof page that is not publicly hosted, a large app console, and explorer links with no README entry point.

# Negative Case Review

Strongest negative path:

> Attempt to issue coverage when free reserve is lower than the requested maximum payout -> `InsufficientFreeReserve` -> no coverage, no lock, no balance movement.

The contract also rejects a replayed signed settlement with `NonceAlreadyUsed`, preventing a second payout.

Current proof quality:

- Contract enforcement: implemented.
- Source tests: extensive, including replay and reserve boundaries.
- Independent live simulation: verified for both over-cap and replay.
- Mined failed transaction: absent.
- Judge-facing UI: over-cap is dynamically checked when `/proof` runs; replay is described in the UI but not dynamically checked there.

This is not an absence of negative proof, but it is a major packaging gap. A skeptical judge should see the rejection without trusting narration or reading source.

# Competitive Failure Analysis

Assuming 100 technically competent submissions, the three strongest reasons Resvyn could still lose are:

1. It may be screened out before scoring because no working public demo or accessible repository is discoverable and the submission form is closed.
2. A technical judge can demonstrate that the evaluator signs caller-provided eligibility and amount data, making the AI verification claim look cosmetic or unsafe.
3. A competitor can show a more BOT-specific mechanism, such as a real sponsored transaction with sponsor-side state, while Resvyn's core contract remains portable standard EVM logic.

A stronger submission could demonstrate this in 30 seconds that Resvyn currently cannot: open a public URL, execute a real BOT-native sponsored action, show the sponsor's state/receipt, deliberately submit an invalid case, and point to a mined rejection or clearly reproducible failure while the judge remains on one screen.

# Six-Gate Scorecard

| Gate | Result | Main reason |
|---|---|---|
| Novelty | BORDERLINE | The reserve-capacity invariant is distinctive, but AI warranty/escrow is a common concept and the mechanism is standard EVM accounting |
| Judge fit | FAIL | Mainnet fit is strong, but no user-accessible product/demo or verifiable submitted surface was found |
| Sponsor necessity | BORDERLINE | BOT Chain is load-bearing for the current proof, yet the architecture is portable and Paymaster is not operational |
| Winning invariant | PASS | "No funded reserve, no valid coverage" is concise, enforced, and memorable |
| 30-second proof | BORDERLINE | Genuine receipts and live negative calls exist, but they are not packaged behind an accessible one-click judge surface |
| Demo compression | BORDERLINE | A 75-90 second story is possible using current proof, but delivery is fragmented and not publicly hosted |

# Overall Classification

**STRONG BUT FIXABLE**

The concept and Mainnet proof are competitive. Specific access, trust-boundary, lifecycle, and evidence-packaging gaps can still cause rejection or disqualification. The project does not need a rebuild; it needs a narrower and more defensible judge surface.

# Must Fix Before Submission

1. **Confirm eligibility and submission receipt.** Find proof that the official form was submitted before August 13 and identify the exact URLs judges received. The form is closed, so use only organizer-approved correction channels.
2. **Provide a stable public product/proof URL.** The competition explicitly rejects inaccessible demos. The first judge link should open the Mainnet proof without a wallet.
3. **Make the archived proof deployment read-only.** Disable all write controls for the default proof address or deploy a fresh verified operational chain/address/signer tuple before enabling real funds.
4. **Remove caller authority over AI approval.** Authenticate evaluation, fetch evidence from a trusted source bound to the on-chain hash, derive the amount server-side, and return no signature on provider failure.
5. **Track a judge-facing README and proof package.** Include the invariant, live URL, Mainnet contract, all six receipts, one negative-check command/link, architecture, setup, and honest limitations.
6. **Fix coverage expiry and lock recovery.** Post-expiry claims must follow an explicit rule, and unused exposure must have a one-time release path.
7. **Clear High production dependency findings.** Upgrade the affected Next/PostCSS/Sharp dependency path and rerun build, tests, and production audit.

# Should Fix

- Add route integration and browser end-to-end coverage for forged evidence, signer mismatch, provider failure, and reverted transactions.
- Restore a working ESLint command and CI quality gates.
- Record a mined negative transaction if BOT Chain/explorer behavior makes failed transactions inspectable; otherwise publish a one-click reproducible simulation.
- Dynamically verify replay on the proof page instead of presenting it as static text.
- Extract one shared evaluator implementation for scripts and web.
- Bound block-log scans and use a deployment start block.
- Add repository description, homepage, license, security policy, screenshots, and a 90-second demo video.
- Integrate BOT EOA Paymaster only when a real endpoint and sponsor-side proof are available.

# Ignore

- Multi-chain support.
- Tokenomics or a project token.
- New insurance/warranty product categories.
- A DAO, upgradeable proxy, or complex governance system for the hackathon submission.
- Large landing-page redesigns.
- More AI models or richer free-text analysis.
- Production-scale indexing, analytics, or multi-region infrastructure before the core trust boundary is fixed.
- Extra marketing pages that do not improve eligibility, proof, sponsor necessity, or a judging criterion.

# Smallest Winning Path

1. Confirm the project is validly submitted and obtain permission for any post-deadline URL correction.
2. Deploy the existing web app to a stable public URL with `/proof` as the primary judge entry and the archived contract strictly read-only.
3. Add one concise README and 90-second video that lead with "No funded reserve, no valid coverage," link all Mainnet receipts, and show the live over-cap/replay rejection.
4. Fix or disable the unsafe evaluator route so no caller-controlled approval can produce a settlement signature; fail closed on provider errors.
5. If operational writes remain in scope, add expiry/unlock recovery, deploy a fresh signer-verified instance, rerun the relevant tests/audits, and update the proof package. Otherwise keep the submission proof-only and do not expand scope.
