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

## The business loop

1. **Merchant funds a reserve** with native BOT.
2. **Merchant issues coverage** for a real buyer and commits the product and
   receipt hashes on chain.
3. **The full maximum payout is locked** immediately. The same funds cannot be
   withdrawn or reused for another warranty.
4. **Buyer opens a claim** and commits one evidence hash.
5. **Authorized evidence is evaluated** under bounded policy. The evaluator
   signs an EIP-712 decision tied to the exact claim and deployment.
6. **The contract settles**. Approval pays the buyer and rejection releases the
   lock. Either outcome is terminal.
7. **Unused coverage expires** and releases its reserve after the warranty
   window ends.

This creates a simple value loop for merchants and buyers: merchants can prove
that warranties are funded, buyers can verify the backing before relying on the
promise, and settlement leaves an on-chain audit trail.

## BOT Chain Mainnet proof

A complete Resvyn lifecycle has already executed on BOT Chain Mainnet,
chain ID `677`:

- WarrantyReserve proof deployment:
  [`0x414592d2313d233b673b1f97803c261355ccd996`](https://scan.botchain.ai/address/0x414592d2313d233b673b1f97803c261355ccd996)
- Approved claim payout, `0.001 BOT`:
  [`0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d`](https://scan.botchain.ai/tx/0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d)
- The `/proof` route re-reads the deployment and recorded receipts from BOT
  Chain rather than treating screenshots or local logs as proof.
- Negative call-level checks demonstrate that over-cap issuance is rejected and
  a consumed settlement nonce cannot be replayed.

The recorded proof deployment is intentionally **archived and read-only**. Its
original evaluator key is no longer an operational signing authority. New live
coverage must use a fresh Mainnet deployment whose evaluator signer is verified
against the server configuration before the UI enables writes.

## Why this is RWA infrastructure

Resvyn does not tokenize a physical product. It handles the funded warranty
obligation attached to one.

A product sale creates a real-world service liability: the merchant promises a
bounded amount if the covered item fails under agreed conditions. Resvyn makes
that liability visible and collateralized on chain. The contract records:

- who issued the coverage,
- who owns the claim right,
- product and receipt commitments,
- the maximum financial exposure,
- the expiry,
- the reserve locked behind the promise,
- and the final settlement outcome.

The same primitive can support electronics resellers, appliance merchants,
repair shops, refurbished-device sellers and independent manufacturers that
want a buyer-verifiable warranty reserve without creating a separate custodian.

## AI is inside the settlement path

AI is not used as a chatbot or copy layer. The optional Groq-backed evaluator is
inside the claim decision path, behind deterministic safety checks.

The evaluator can propose a structured decision, but it cannot bypass the
contract's financial boundaries. The signed payload includes the chain,
verifier, claim, coverage, claimant, evidence hash, amount, result, model
version, expiry and nonce. The contract rejects wrong-chain decisions, wrong
verifiers, mismatched claims, replayed nonces and approvals above the coverage
cap.

When the optional AI provider is enabled, provider errors, timeouts, malformed
responses and schema failures fail closed without a settlement signature.

## Evidence and authenticity model

Resvyn is explicit about what it can verify.

The claimant or merchant attests one evidence snapshot. The server checks that
its canonical hash is the hash already committed by the on-chain claim and that
the signer is authorized for that claim. Product and receipt matches are
independently derived by comparing the supplied notes with the hashes committed
at coverage issuance.

Damage eligibility, evidence completeness and file-integrity flags remain
attestations from the authorized party. Resvyn therefore provides cryptographic
binding, reserve solvency and policy enforcement. It does not claim to prove
physical-world damage without an external oracle or inspection source.

## Contract invariants

`contracts/WarrantyReserve.sol` enforces the financial core:

- zero-value reserve deposits are rejected;
- coverage requires a real claimant, non-zero product and receipt commitments,
  a non-zero payout cap and a future expiry;
- `maxPayout` cannot exceed the merchant's free reserve;
- locked exposure increases by the full `maxPayout` at issuance;
- withdrawals cannot touch locked exposure and zero-value withdrawals are
  rejected;
- only the bound buyer can open a claim;
- one coverage can create at most one claim;
- claims bind exactly one evidence hash;
- settlement requires the immutable evaluator's EIP-712 signature;
- approved payouts are bounded by `maxPayout`;
- nonces are single-use and terminal claims cannot be paid twice;
- payout accounting is updated before the external transfer and settlement is
  reentrancy guarded;
- failed payouts revert the entire state transition;
- unused expired coverage releases its lock exactly once.

## Product surfaces

The Next.js app under `web/` contains the full product surface:

- `/` — product and RWA value proposition
- `/app` — wallet workspace for reserve funding, coverage issuance, claims,
  evaluation, settlement and withdrawals
- `/demo` — controlled lifecycle walkthrough for fast product understanding
- `/proof` — live Mainnet proof verifier
- `/reserve` — public reserve lookup
- `/faq` — product and trust-model answers
- `/privacy` and `/terms` — supporting product pages

The default repository configuration points `/app` at the archived proof
instance and therefore renders writes read-only. Operators must explicitly
configure and verify a fresh deployment before enabling transactions.

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
        │ authorized evidence + claim state
        │
Deterministic policy ── optional AI decision layer
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

## Why BOT Chain

Resvyn uses BOT Chain as the settlement and reserve layer, not as a decorative
network badge:

- merchant reserves are native BOT held by the contract;
- coverage locks and free-reserve accounting live on Mainnet;
- claims and settlement receipts are publicly inspectable through BOTScan;
- the app connects wallets directly to BOT Chain Mainnet;
- the evaluator signature is bound to chain `677` and the exact verifier
  contract, so a valid Resvyn decision cannot be replayed onto another chain or
  deployment;
- an EOA Paymaster integration is implemented for a future sponsored-claim path
  and remains disabled unless an actual BOT Chain paymaster endpoint is
  configured.

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

## Operational deployment

A write-enabled deployment needs a fresh Mainnet contract and a server that can
persist evidence safely.

Frontend configuration:

```bash
NEXT_PUBLIC_RESVYN_ADDRESS=<fresh-mainnet-contract>
NEXT_PUBLIC_RESVYN_OPERATIONAL=1
NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR=<contract-evaluator-signer>
NEXT_PUBLIC_DEPLOY_START_BLOCK=<deployment-block>
```

Server configuration:

```bash
RESVYN_EVALUATOR_KEY=<server-only-private-key>
RESVYN_GROQ_KEY=<optional-provider-key>
RESVYN_EVIDENCE_STORE_PATH=<durable-writable-path>
```

The evidence store writes to disk before acknowledging intake. An operational
host therefore needs durable writable storage. A multi-instance deployment
needs shared persistence, and the process-local rate limiter should be replaced
with a shared backend before horizontal scaling.

See [`SECURITY.md`](SECURITY.md) for the complete trust model and deployment
gates.

## Verification

CI currently gates:

- Hardhat compilation and contract tests
- evaluator parity tests
- frontend linting and TypeScript checks
- unit and API route integration tests
- production Next.js build
- production web dependency audit

The contract suite covers reserve boundaries, multi-merchant isolation,
coverage expiry, claim authorization, signature binding, payout rollback,
replay resistance and reentrancy behavior.

## Current limitations

Resvyn is pre-production and should be treated accordingly:

- the recorded Mainnet proof deployment is archived, so a fresh verified
  deployment is required for new operational coverage;
- the evaluator signer is immutable, which keeps settlement authority simple
  but means signer loss requires migration to a new deployment;
- physical-world damage is attested, not independently proven by an oracle;
- the default evidence store is single-host durable storage, not a distributed
  database;
- rate limiting is process-local;
- no independent production security audit has been completed yet.

## Roadmap

The next operational milestones are deliberately product-focused:

1. fresh verified BOT Chain Mainnet deployment with a production-managed
   evaluator key;
2. public hosted product backed by durable evidence persistence;
3. merchant checkout/API integration so coverage can be issued from real sales;
4. optional independent inspection/oracle adapters for higher-value claims;
5. shared evidence and rate-limit infrastructure for multi-instance hosting;
6. external contract/security review before material value is placed at risk.

## License

MIT, see [`LICENSE`](LICENSE).
