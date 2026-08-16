# Resvyn

**Fund the warranty before you issue it.**

Resvyn is RWA warranty infrastructure on BOT Chain. A merchant deposits native
BOT, issues buyer-bound product coverage, and the contract locks that
coverage's full maximum payout before the warranty becomes valid. If the buyer
opens a claim, a bounded evaluator produces a signed decision that the contract
verifies before paying from the reserved funds.

> **No funded reserve, no valid coverage.**

Resvyn is designed for real-world commerce where a warranty is a financial
promise attached to a physical purchase. The product turns that promise into a
verifiable, funded liability instead of leaving the buyer to trust that money
will still be available when a claim arrives.

## Live product

- **Production:** https://resvyn.vercel.app
- **App:** https://resvyn.vercel.app/app
- **Guided demo:** https://resvyn.vercel.app/demo
- **Mainnet proof:** https://resvyn.vercel.app/proof
- **Reserve lookup:** https://resvyn.vercel.app/reserve

The production app currently reads the fresh Mainnet deployment live. Writes
remain intentionally disabled until the operator pins the expected evaluator,
provisions the matching server-only evaluator key, enables the operational flag,
and runs the evaluator on infrastructure with durable evidence persistence.
That fail-closed state prevents funds from being locked before the full
settlement path is ready.

## Current BOT Chain Mainnet deployment

The current hardened `WarrantyReserve` is deployed and source-verified on BOT
Chain Mainnet, chain ID `677`.

- **WarrantyReserve:**
  [`0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe`](https://scan.botchain.ai/address/0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe)
- **Immutable evaluator signer:**
  `0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0`
- **Deploy transaction:**
  [`0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49`](https://scan.botchain.ai/tx/0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49)
- **Deployment block:** `19898630`
- **Source verification:** BOTScan verified, Solidity
  `0.8.28+commit.7893614a`, optimizer disabled
- **Smoke test:** `0.001 BOT` deposited and read back as
  `0.001 balance / 0 locked / 0.001 free`

The frontend now points at this deployment. The live reserve panel and event log
read the smoke deposit directly from BOT Chain Mainnet.

## Recorded full lifecycle proof

Before the hardened deployment above, Resvyn executed a complete disposable
lifecycle on an earlier Mainnet instance. That instance is retained as an
**archived proof contract** so judges and users can independently verify a full
reserve-to-settlement run without trusting screenshots or local logs.

- **Archived proof deployment:**
  [`0x414592d2313d233b673b1f97803c261355ccd996`](https://scan.botchain.ai/address/0x414592d2313d233b673b1f97803c261355ccd996)
- **Recorded approved payout, `0.001 BOT`:**
  [`0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d`](https://scan.botchain.ai/tx/0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d)
- **Lifecycle:** deploy → reserve deposit → coverage issuance → claim →
  evaluator-signed payout → reserve withdrawal
- **Final reserve state:** `0 / 0 / 0`
- **Negative proofs:** over-cap issuance reverts and a consumed settlement nonce
  cannot be replayed

The `/proof` route re-reads the archived contract state and all six recorded
receipts directly from BOT Chain RPC in the browser. It also re-runs the
negative checks with `eth_call`, so the proof does not depend on screenshots or
an indexer.

The archived contract is deliberately read-only in the product because its
original evaluator key is no longer an operational signing authority. New
coverage belongs on the current deployment above.

## The business loop

1. **Merchant funds a reserve** with native BOT.
2. **Merchant issues coverage** for a real buyer and commits the product and
   receipt hashes on chain.
3. **The full maximum payout is locked immediately.** The same funds cannot be
   withdrawn or reused for another warranty.
4. **Buyer opens a claim** and commits one evidence hash.
5. **Authorized evidence is evaluated** under bounded policy. The evaluator
   signs an EIP-712 decision tied to the exact claim and deployment.
6. **The contract settles.** Approval pays the buyer and rejection releases the
   lock. Either outcome is terminal.
7. **Unused coverage expires** and releases its reserve after the warranty
   window ends.

This creates a complete value loop for merchants and buyers: merchants can prove
that warranties are funded, buyers can verify the backing before relying on the
promise, and settlement leaves an on-chain audit trail.

## Why this is RWA infrastructure

Resvyn does not tokenize a physical product. It handles the funded warranty
obligation attached to one.

A product sale creates a real-world service liability: the merchant promises a
bounded amount if the covered item fails under agreed conditions. Resvyn makes
that liability visible and collateralized on chain. The contract records:

- who issued the coverage;
- who owns the claim right;
- product and receipt commitments;
- the maximum financial exposure;
- the expiry;
- the reserve locked behind the promise; and
- the final settlement outcome.

The same primitive can support electronics resellers, appliance merchants,
repair shops, refurbished-device sellers and independent manufacturers that
want a buyer-verifiable warranty reserve without creating a separate custodian.

## Why BOT Chain

BOT Chain is the reserve and settlement layer, not a decorative network badge.

- merchant reserves are native BOT held by the contract;
- coverage locks and free-reserve accounting live on Mainnet;
- claims and settlement receipts are publicly inspectable through BOTScan;
- the app connects wallets directly to BOT Chain Mainnet;
- the evaluator signature is bound to chain `677` and the exact verifier
  contract, so a valid decision cannot be replayed onto another chain or
  deployment; and
- an EOA Paymaster integration is implemented for a future sponsored-claim path
  and remains disabled unless a real BOT Chain paymaster endpoint is configured.

## Bounded evaluator inside settlement

The evaluator is not a chatbot or copy layer. It sits inside the claim settlement
path behind deterministic checks.

The optional Groq-backed decision layer can propose a structured decision. The
server then applies schema and policy gates, binds the decision to live on-chain
claim state, and signs only when the deployment, evidence and evaluator authority
all match.

The signed payload includes the chain, verifier, claim, coverage, claimant,
evidence hash, amount, result, model version, expiry and nonce. The contract
rejects wrong-chain decisions, wrong verifiers, mismatched claims, replayed
nonces and approvals above the coverage cap.

The chain proves that settlement was authorized by the deployment's immutable
evaluator signer. It does not by itself prove which off-chain model produced the
proposal. Provider errors, timeouts, malformed responses and schema failures
fail closed without a settlement signature.

## Evidence and authenticity model

Resvyn is explicit about what it can and cannot verify.

The claimant or merchant attests one evidence snapshot. The server verifies that
its canonical hash equals the claim's on-chain `evidenceHash` and that the signer
is authorized for that claim. Product and receipt matches are independently
derived by comparing the supplied notes with the hashes committed at coverage
issuance.

Damage eligibility, evidence completeness and file-integrity flags remain
attestations from the authorized party. Resvyn therefore provides cryptographic
binding, reserve solvency and policy enforcement. It does not claim to prove
physical-world damage without an external oracle or inspection source.

Evidence is first-write-wins, claim-bound and persisted before the server
acknowledges intake. If persistence fails or the store cannot be loaded, the
evaluator fails closed and signs nothing.

## Contract invariants

`contracts/WarrantyReserve.sol` enforces the financial core:

- zero-value reserve deposits and withdrawals are rejected;
- coverage requires a real claimant, non-zero product and receipt commitments,
  a non-zero payout cap and a future expiry;
- `maxPayout` cannot exceed the merchant's free reserve;
- locked exposure increases by the full `maxPayout` at issuance;
- withdrawals cannot touch locked exposure;
- only the bound buyer can open a claim;
- one coverage can create at most one claim;
- claims bind exactly one evidence hash;
- settlement requires the immutable evaluator's EIP-712 signature;
- approved payouts are bounded by `maxPayout`;
- nonces are single-use and terminal claims cannot be paid twice;
- payout accounting is updated before the external transfer and settlement is
  reentrancy guarded;
- failed payouts revert the entire state transition; and
- unused expired coverage releases its lock exactly once.

## Product surfaces

The Next.js app under `web/` contains the complete user-facing product:

- `/` — product and RWA value proposition
- `/app` — live Mainnet workspace for reserve, coverage, claims and settlement
- `/demo` — controlled lifecycle walkthrough for fast product understanding
- `/proof` — archived full-lifecycle Mainnet receipt verifier plus current
  deployment context
- `/reserve` — public reserve lookup
- `/faq` — product and trust-model answers
- `/privacy` and `/terms` — supporting product pages

## Architecture

```text
Merchant / buyer wallet
        │
        ├── deposit / issue / open / resolve / withdraw
        ▼
BOT Chain Mainnet
WarrantyReserve.sol
        ▲
        │ EIP-712 bounded decision
        │
Next.js evaluator API
        ▲
        │ authorized, claim-bound evidence
        │
Deterministic policy ── optional Groq decision layer
        │
Durable evidence store
```

Important implementation paths:

- `contracts/WarrantyReserve.sol` — reserve, coverage and settlement contract
- `scripts/evaluator/` — evaluator policy/schema/signing implementation
- `parity/evaluator.parity.test.ts` — byte-level evaluator parity checks
- `web/app/api/evidence/route.ts` — authenticated evidence intake
- `web/app/api/evaluate/route.ts` — bounded signed-decision endpoint
- `web/lib/evidenceStore.ts` — fail-closed evidence persistence
- `web/components/AppConsole.tsx` — wallet workflow
- `web/lib/proofEngine.ts` — Mainnet proof verification

## Safe deployment gate

The repository defaults to the current Mainnet contract in **read-only** mode.
A clone cannot enable writes merely by having a valid contract address.

Write mode requires all of the following:

1. `NEXT_PUBLIC_RESVYN_ADDRESS` points at a non-archived Mainnet deployment.
2. `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR` pins the expected immutable signer.
3. The app reads the live `evaluatorSigner` and it matches the pin.
4. `NEXT_PUBLIC_RESVYN_OPERATIONAL=1` is explicitly set.
5. The server has the matching `RESVYN_EVALUATOR_KEY`.
6. The evaluator API independently verifies its server key against the on-chain
   immutable signer before signing.
7. Evidence persistence is durable and writable.

If any gate fails, the product remains read-only or the evaluator refuses to
sign.

## Run locally

Prerequisites: Node.js 22+ and npm.

```bash
# Contracts
npm ci
npm run compile
npm test
npm run test:parity

# Web
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Copy `web/.env.example` to `web/.env.local` for local configuration. The example
uses the current Mainnet contract but keeps operational writes disabled.

## Verification and CI

The current test surface includes **102 contract tests + 54 web tests**.

CI gates:

- repository secret-signature hygiene;
- Hardhat compilation and contract tests;
- evaluator parity tests;
- contract dependency audit;
- frontend linting and TypeScript checks;
- unit and API route integration tests;
- production Next.js build; and
- production web dependency audit.

The contract suite covers reserve boundaries, multi-merchant isolation,
coverage expiry, claim authorization, signature binding, payout rollback,
replay resistance and reentrancy behavior.

## Current operational status

- [x] Hardened WarrantyReserve deployed to BOT Chain Mainnet
- [x] Source verified on BOTScan
- [x] Fresh immutable evaluator signer verified on chain
- [x] `0.001 BOT` smoke reserve deposited and read live by the app
- [x] Production frontend points at the current deployment
- [x] Archived full lifecycle remains independently verifiable on `/proof`
- [x] Contract, web, typecheck, lint and build gates green
- [ ] Pin the production evaluator and provision the matching server-only key
- [ ] Run the evaluator API on durable writable evidence storage
- [ ] Execute and record a full lifecycle on the current hardened deployment
- [ ] Record the final product demo

## Current limitations

Resvyn is pre-production and should be treated accordingly:

- public writes are intentionally disabled until the evaluator and persistence
  release gates are satisfied;
- the evaluator signer is immutable, which keeps settlement authority simple but
  means signer loss requires migration to a new deployment;
- physical-world damage is attested, not independently proven by an oracle;
- the default evidence adapter is single-host durable storage, not a distributed
  database;
- rate limiting is process-local; and
- no independent production security audit has been completed.

## Roadmap

1. full disposable lifecycle rehearsal on the current verified Mainnet contract;
2. durable evaluator hosting and operational write enablement;
3. merchant checkout/API integration so coverage can be issued from real sales;
4. optional independent inspection/oracle adapters for higher-value claims;
5. shared evidence and rate-limit infrastructure for multi-instance hosting;
6. external contract/security review before material value is placed at risk.

## License

MIT, see [`LICENSE`](LICENSE).
