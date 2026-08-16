# Resvyn

**Fund the warranty before you issue it.**

Resvyn is warranty-reserve infrastructure on BOT Chain. A merchant deposits native BOT, issues buyer-bound coverage for a real purchase, and the contract locks the full maximum payout before the warranty becomes valid.

If the buyer later opens a claim, authorized evidence enters a bounded evaluator. The resulting EIP-712 decision is verified by the contract before any payout is released.

> **No funded reserve, no valid coverage.**

## Live product

- **Production:** https://resvyn.vercel.app
- **App:** https://resvyn.vercel.app/app
- **Mainnet proof:** https://resvyn.vercel.app/proof
- **Guided demo:** https://resvyn.vercel.app/demo
- **Reserve lookup:** https://resvyn.vercel.app/reserve
- **WarrantyReserve:** [`0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe`](https://scan.botchain.ai/address/0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe)

The production app runs against BOT Chain Mainnet, chain ID `677`, and the proof route re-reads the current deployment and lifecycle receipts from chain instead of relying on screenshots or mocked balances.

## The problem

A warranty is a financial promise attached to a real-world product, but the buyer normally has no way to verify that the merchant has actually reserved money to honor it.

Resvyn turns that promise into a **pre-funded, buyer-verifiable liability**.

The merchant funds a reserve first. When coverage is issued, the full maximum payout is locked immediately. Those funds cannot be withdrawn or reused while they back an active warranty obligation.

## How it works

1. **Fund reserve** — the merchant deposits native BOT.
2. **Issue coverage** — coverage is bound to a buyer, product commitment, receipt commitment, maximum payout, and expiry.
3. **Lock exposure** — the contract immediately locks the full maximum payout.
4. **Open claim** — the buyer commits a canonical evidence hash on chain.
5. **Attest evidence** — authorized evidence is stored durably and bound to that claim.
6. **Evaluate** — the evaluator applies bounded policy and signs an EIP-712 settlement decision.
7. **Settle** — approval pays the buyer; rejection releases the lock.
8. **Reconcile** — released free reserve remains withdrawable by the merchant.

Every financial state transition remains inspectable on BOT Chain.

## Current Mainnet deployment

The current `WarrantyReserve` is deployed, source-verified, and has completed a full end-to-end lifecycle.

- **Contract:** [`0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe`](https://scan.botchain.ai/address/0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe)
- **Immutable evaluator:** `0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0`
- **Deploy transaction:** [`0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49`](https://scan.botchain.ai/tx/0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49)
- **Deployment block:** `19898630`
- **Source:** BOTScan verified, Solidity `0.8.28+commit.7893614a`, optimizer disabled
- **Evaluator/evidence backend:** durable VPS service over HTTPS

A separate `0.001 BOT` smoke reserve remains under another merchant account from deployment verification. It is not part of the lifecycle accounting below.

## Full Mainnet lifecycle proof

The primary proof uses the same contract as the live app, with a fresh merchant and a separate buyer.

### Parties and claim

- **Merchant:** `0x465978e73157bC10f550Ef043f503B2BE51F4473`
- **Buyer:** `0x88CaaD90511bB5a050235c208955b0122d914E1C`
- **Coverage ID:** `1`
- **Claim ID:** `1`
- **Evidence hash:** `0xcf183bb9d7fb810442c1638898d1ac47b76ce67d91b4e4b649cfb8b1a7f8da66`
- **Maximum payout:** `0.0005 BOT`
- **Decision:** `APPROVE`
- **Model version:** `resvyn-groq-openai/gpt-oss-120b`
- **Settlement nonce:** `1`

### Mainnet receipts

| Step | Block | Gas | Transaction |
| --- | ---: | ---: | --- |
| Deposit `0.001 BOT` reserve | `19907015` | `45,804` | [`0x26d504...bc99c`](https://scan.botchain.ai/tx/0x26d5043e90ab88d9fb5badf26139d8c87b70c3fd9c60fbcc7a0d743cc78bc99c) |
| Issue buyer-bound coverage #1 | `19907067` | `207,874` | [`0x092462...42854`](https://scan.botchain.ai/tx/0x092462f9235269772a8a8ab9d919224deccd2224238e0c88c344de3f24f42854) |
| Buyer opens evidence-bound claim #1 | `19907119` | `165,789` | [`0x96746e...c7b6c`](https://scan.botchain.ai/tx/0x96746e608d58ee6b10129be8087c68d44157443afb4becd249d5a1ce7c7c7b6c) |
| Evaluator-authorized `0.0005 BOT` payout | `19908496` | `117,884` | [`0x23a30d...4f2ba`](https://scan.botchain.ai/tx/0x23a30d8c82389367ce3d77c6e400751ba440008bb5149af409399f22dcc4f2ba) |
| Withdraw remaining `0.0005 BOT` free reserve | `19908578` | `34,024` | [`0x55b70b...151db`](https://scan.botchain.ai/tx/0x55b70b96630e8bac8826a0a2f464a786f6313e0052c9bd78c7111efa5bb151db) |

### Reserve accounting

| State | Balance | Locked | Free |
| --- | ---: | ---: | ---: |
| After deposit | `0.001` | `0` | `0.001` |
| After coverage issuance | `0.001` | `0.0005` | `0.0005` |
| After approved settlement | `0.0005` | `0` | `0.0005` |
| After merchant withdrawal | `0` | `0` | `0` |

The buyer received exactly `0.0005 BOT`, moving from `0.00268422 BOT` to `0.00318422 BOT`. Claim #1 finalized as `Approved` with `500000000000000 wei` paid.

### Evidence and evaluator proof

The lifecycle used the production evidence path rather than a local fixture:

1. the buyer committed the canonical evidence hash on chain;
2. authenticated evidence intake stored the claim-bound record;
3. the evidence record survived an evaluator-service restart;
4. the evaluator read the live claim and durable evidence;
5. the bounded model proposal passed policy and schema gates;
6. the server signed the final EIP-712 decision; and
7. the recovered signer matched the contract's immutable evaluator.

The `/proof` route re-fetches the current contract state and all five receipts from BOT Chain RPC. It also checks the durable evidence record through the production API.

### Negative proofs

- **Replay resistance:** replaying the consumed settlement nonce is rejected with `NonceAlreadyUsed`.
- **Reserve solvency:** issuance above the merchant's free reserve is rejected with `InsufficientFreeReserve`.

Both checks were performed without moving additional funds.

## Why the warranty obligation is on chain

Resvyn does not tokenize the physical product. It puts the **financial obligation created by the sale** on chain.

The contract records and enforces:

- who issued the warranty;
- who owns the claim right;
- product and receipt commitments;
- maximum financial exposure;
- expiry;
- reserve locked behind the promise; and
- the terminal settlement outcome.

This keeps the real-world product off chain while making the warranty liability visible, collateralized, and auditable.

## Why BOT Chain

BOT Chain is the reserve and settlement layer.

- merchant reserves are native BOT held by `WarrantyReserve`;
- coverage locks and free-reserve accounting live on Mainnet;
- claims and settlement receipts are publicly inspectable;
- the app connects wallets directly to BOT Chain Mainnet;
- evaluator decisions are bound to chain `677` and the exact verifier contract; and
- a valid settlement cannot be replayed onto another chain or another Resvyn deployment.

Without the chain-level reserve, the buyer cannot independently verify that funds are already locked behind the warranty.

## Claim evaluation

The evaluator sits inside the settlement path behind deterministic checks.

A Groq-backed model can propose a structured claim decision. The server then validates the output against policy and schema, binds it to the live on-chain claim, and signs only when the deployment, evidence, claimant, amount, nonce, and evaluator authority all match.

The signed EIP-712 payload includes the chain, verifier, claim, coverage, claimant, evidence hash, amount, result, model version, expiry, and nonce.

Provider errors, malformed output, missing evidence, signer mismatch, stale authorization, or persistence failure fail closed without a settlement signature.

The chain proves that the immutable evaluator authorized the settlement. It does not independently prove which off-chain model produced the proposal.

## Contract invariants

`contracts/WarrantyReserve.sol` enforces the financial core:

- zero-value deposits and withdrawals are rejected;
- coverage requires a real claimant, non-zero purchase commitments, non-zero payout cap, and future expiry;
- `maxPayout` cannot exceed the merchant's free reserve;
- the full `maxPayout` is locked at issuance;
- withdrawals cannot touch locked exposure;
- only the bound buyer can open the claim;
- one coverage can create at most one claim;
- a claim binds one evidence hash;
- settlement requires the immutable evaluator's EIP-712 signature;
- approved payouts cannot exceed `maxPayout`;
- nonces are single-use and terminal claims cannot be paid twice;
- settlement updates accounting before the external payout and is reentrancy guarded; and
- unused expired coverage releases its lock exactly once.

## Evidence and real-world scope

The claimant or merchant attests one evidence snapshot. The server verifies that its canonical hash equals the claim's on-chain `evidenceHash`, verifies that the signer is authorized, and derives product and receipt matches against the commitments made when coverage was issued.

Damage eligibility and evidence completeness remain real-world attestations unless an external inspection or oracle source is connected.

Resvyn therefore proves **funding, authorization, cryptographic binding, reserve solvency, and policy enforcement**. It does not claim to independently prove physical-world damage.

Resvyn is a warranty-reserve primitive rather than an insurance-underwriting or identity system. Merchants remain responsible for their warranty terms and applicable consumer obligations. Higher-value deployments can attach identity, inspection, or oracle adapters without changing the reserve model.

## Architecture

```text
Merchant / buyer wallet
        │
        ├── deposit / issue / open / resolve / withdraw
        ▼
BOT Chain Mainnet · chain 677
WarrantyReserve.sol
        ▲
        │ EIP-712 settlement decision
        │
VPS evaluator API · HTTPS
        ▲
        │ authorized, claim-bound evidence
        │
Deterministic policy ── optional Groq proposal
        │
Durable evidence store · atomic, fail-closed

Vercel frontend ── HTTPS ──► VPS evaluator API
```

Important implementation paths:

- `contracts/WarrantyReserve.sol` — reserve, coverage, and settlement contract
- `scripts/evaluator/` — evaluator policy, schema, and signing implementation
- `parity/evaluator.parity.test.ts` — evaluator parity checks
- `web/app/api/evidence/route.ts` — authenticated evidence intake
- `web/app/api/evaluate/route.ts` — signed-decision endpoint
- `web/lib/evidenceStore.ts` — durable fail-closed evidence persistence
- `web/lib/evaluateAuth.ts` — canonical authorization messages and signer recovery
- `web/components/AppConsole.tsx` — wallet workflow
- `web/lib/currentProof.ts` — current lifecycle receipt manifest
- `web/lib/currentProofEngine.ts` — live proof verification

## Safety model

The production write path is gated at both the client and evaluator layers.

The browser verifies that it is connected to the intended Mainnet deployment and that the immutable evaluator matches the configured signer before enabling writes. The evaluator independently verifies its own signing authority and durable evidence before producing a settlement signature.

If those checks fail, the client becomes read-only or the evaluator refuses to sign.

Exact deployment variables and operational procedures live in [`SECURITY.md`](SECURITY.md) and [`web/.env.example`](web/.env.example).

## Product surfaces

- `/` — product overview and value proposition
- `/app` — operational reserve, coverage, claim, evidence, and settlement workflow
- `/demo` — guided lifecycle walkthrough
- `/proof` — independent Mainnet lifecycle verifier
- `/reserve` — public reserve lookup
- `/faq` — product and trust-model answers

## Verification and CI

Automated verification covers:

- contract compilation and behavior tests;
- reserve and claim invariants;
- evaluator parity and signature binding;
- replay, payout-cap, expiry, rollback, and reentrancy behavior;
- evidence-store and API route integration;
- authorization-message canonicalization;
- frontend linting, type checks, tests, and production build;
- dependency audits; and
- tracked-file secret-signature hygiene.

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

Copy `web/.env.example` to `web/.env.local` for local configuration. Development remains fail-closed by default.

## Historical proof

An earlier disposable Mainnet lifecycle remains archived at [`0x414592d2313d233b673b1f97803c261355ccd996`](https://scan.botchain.ai/address/0x414592d2313d233b673b1f97803c261355ccd996).

It is historical evidence only. The current production deployment and primary proof both use `0x96829b...54ffe`.

## Known limitations

Resvyn is early-stage software:

- the evaluator signer is immutable, so signer loss requires migration to a new deployment;
- physical-world damage is attested unless an external inspection or oracle source is connected;
- the current evidence backend is durable single-host storage rather than a replicated database;
- rate limiting is process-local; and
- the contracts have not received an independent production security audit.

## Roadmap

1. merchant checkout/API integration for warranty issuance directly from real sales;
2. optional independent inspection and oracle adapters for higher-value claims;
3. replicated evidence and rate-limit infrastructure for multi-instance hosting;
4. evaluator-key migration design for production operations; and
5. external contract and security review before material value is placed at risk.

## License

MIT, see [`LICENSE`](LICENSE).
