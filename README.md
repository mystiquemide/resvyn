# Resvyn

**Fund the warranty before you issue it.**

Resvyn is RWA warranty infrastructure on BOT Chain. A merchant deposits native BOT, issues buyer-bound product coverage, and the contract locks the coverage's full maximum payout before the warranty becomes valid. If the buyer opens a claim, a bounded evaluator produces a signed decision that the contract verifies before paying from the reserved funds.

> **No funded reserve, no valid coverage.**

A warranty is a financial promise attached to a real-world purchase. Resvyn turns that promise into a visible, funded liability instead of asking a buyer to trust that the merchant will still have money available when a claim arrives.

## Live product

- **Production:** https://resvyn.vercel.app
- **Live app:** https://resvyn.vercel.app/app
- **Guided demo:** https://resvyn.vercel.app/demo
- **Current Mainnet proof:** https://resvyn.vercel.app/proof
- **Reserve lookup:** https://resvyn.vercel.app/reserve

The production app is operational against BOT Chain Mainnet, chain ID `677`. The frontend is deployed on Vercel while evidence persistence and evaluator signing run on a durable VPS backend. Client writes only unlock when the connected wallet is on chain `677`, the configured contract is operational, and the live immutable evaluator matches the pinned signer.

## Current BOT Chain Mainnet deployment

The current hardened `WarrantyReserve` is deployed, source-verified, and has completed a real end-to-end warranty lifecycle.

- **WarrantyReserve:** [`0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe`](https://scan.botchain.ai/address/0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe)
- **Immutable evaluator signer:** `0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0`
- **Deploy transaction:** [`0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49`](https://scan.botchain.ai/tx/0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49)
- **Deployment block:** `19898630`
- **Source verification:** BOTScan verified, Solidity `0.8.28+commit.7893614a`, optimizer disabled
- **Production evaluator API:** `https://resvyn-api.159.69.241.122.sslip.io`
- **Durable evidence store:** VPS-backed, disk-first atomic persistence with fail-closed recovery

A separate `0.001 BOT` smoke reserve deposited before the final lifecycle remains untouched under another merchant account. It is not part of the fresh proof accounting below.

## Current full Mainnet lifecycle proof

This is the primary Resvyn proof. It uses the **same current contract as the production app**, a fresh merchant, a separate fresh buyer, the production evidence backend, and the immutable production evaluator.

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

The claim used the production evidence path rather than a local-only fixture:

1. the buyer committed the canonical evidence hash on chain;
2. authenticated evidence intake returned success and `attested=true`;
3. the evidence record survived a full evaluator-service restart;
4. the evaluator read the live claim and durable evidence record;
5. the bounded Groq-backed proposal passed deterministic policy/schema gates;
6. the server signed the final EIP-712 decision; and
7. the recovered signer was exactly `0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0`, matching the contract's immutable evaluator.

The `/proof` route re-fetches the current contract state and all five lifecycle receipts directly from BOT Chain RPC in the browser. It also checks the durable evidence record through the production API and re-runs the over-cap reserve rejection with `eth_call`.

### Negative proofs

- **Replay:** replaying the already-used signed settlement was simulated and rejected with `NonceAlreadyUsed`. The live proof page independently verifies that nonce `1` is consumed.
- **Over-cap issuance:** attempting to issue exposure above the fresh merchant's free reserve was simulated and rejected with `InsufficientFreeReserve`. No state changed and no funds moved.

## Historical lifecycle proof

Resvyn also retains an earlier disposable Mainnet lifecycle as historical evidence. It is **not** the current deployment and is never presented as the production contract.

- **Historical contract:** [`0x414592d2313d233b673b1f97803c261355ccd996`](https://scan.botchain.ai/address/0x414592d2313d233b673b1f97803c261355ccd996)
- **Historical evaluator:** `0xb1CB08A7f81c0722941ACaDD1eC3E521358a455E`
- **Historical approved payout:** [`0.001 BOT`](https://scan.botchain.ai/tx/0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d)
- **Historical final reserve:** `0 / 0 / 0`

That contract remains read-only because its original evaluator key is not an operational signing authority. New coverage belongs on the current `0x96829b...54ffe` deployment.

## The business loop

1. **Merchant funds a reserve** with native BOT.
2. **Merchant issues coverage** for a real buyer and commits product and receipt hashes on chain.
3. **The full maximum payout is locked immediately.** The same funds cannot be withdrawn or reused for another warranty.
4. **Buyer opens a claim** and commits one canonical evidence hash.
5. **Authorized evidence is persisted durably** and bound to the claim.
6. **The evaluator applies bounded policy** and signs an EIP-712 decision tied to the exact deployment and claim.
7. **The contract settles.** Approval pays the buyer and rejection releases the lock. Either outcome is terminal.
8. **Free reserve remains withdrawable** by the merchant after obligations are released.

## Why this is RWA infrastructure

Resvyn does not tokenize a physical product. It handles the funded warranty obligation attached to one.

A product sale creates a real-world service liability: the merchant promises a bounded amount if the covered item fails under agreed conditions. Resvyn makes that liability visible and collateralized on chain. The contract records:

- who issued the coverage;
- who owns the claim right;
- product and receipt commitments;
- the maximum financial exposure;
- the expiry;
- the reserve locked behind the promise; and
- the final settlement outcome.

The same primitive can support electronics resellers, appliance merchants, repair shops, refurbished-device sellers, and independent manufacturers that want a buyer-verifiable warranty reserve without creating a separate custodian.

## Why BOT Chain

BOT Chain is the reserve and settlement layer, not a decorative network badge.

- merchant reserves are native BOT held by the contract;
- coverage locks and free-reserve accounting live on Mainnet;
- claims and settlement receipts are publicly inspectable through BOTScan;
- the app connects wallets directly to BOT Chain Mainnet;
- the evaluator signature is bound to chain `677` and the exact verifier contract, so a valid decision cannot be replayed onto another chain or deployment; and
- an EOA Paymaster integration is implemented for a future sponsored-claim path and remains disabled unless a real BOT Chain paymaster endpoint is configured.

## Bounded evaluator inside settlement

The evaluator is not a chatbot or copy layer. It sits inside the claim settlement path behind deterministic checks.

The optional Groq-backed decision layer proposes a structured decision. The server then applies schema and policy gates, binds the decision to live on-chain claim state, and signs only when the deployment, evidence, and evaluator authority all match.

The signed payload includes the chain, verifier, claim, coverage, claimant, evidence hash, amount, result, model version, expiry, and nonce. The contract rejects wrong-chain decisions, wrong verifiers, mismatched claims, replayed nonces, and approvals above the coverage cap.

The chain proves that settlement was authorized by the deployment's immutable evaluator signer. It does not by itself prove which off-chain model produced the proposal. Provider errors, timeouts, malformed responses, persistence failures, and schema failures fail closed without a settlement signature.

## Evidence and authenticity model

The claimant or merchant attests one evidence snapshot. The server verifies that its canonical hash equals the claim's on-chain `evidenceHash` and that the signer is authorized for that claim. Product and receipt matches are independently derived by comparing the supplied notes with the hashes committed at coverage issuance.

Damage eligibility, evidence completeness, and file-integrity flags remain attestations from the authorized party. Resvyn therefore provides cryptographic binding, reserve solvency, authorization, and policy enforcement. It does not claim to independently prove physical-world damage without an external oracle or inspection source.

Evidence is first-write-wins, claim-bound, and persisted before the server acknowledges intake. If persistence fails or the store cannot be loaded, the evaluator fails closed and signs nothing.

### Integration note: canonical verifier casing

The EIP-191 evidence and evaluation authorization messages canonicalize the verifier with viem `getAddress()` before signing. This keeps the browser and external scripts byte-identical even when a caller starts from the lowercase contract address. Regression tests cover lowercase and checksummed inputs.

## Contract invariants

`contracts/WarrantyReserve.sol` enforces the financial core:

- zero-value reserve deposits and withdrawals are rejected;
- coverage requires a real claimant, non-zero product and receipt commitments, a non-zero payout cap, and a future expiry;
- `maxPayout` cannot exceed the merchant's free reserve;
- locked exposure increases by the full `maxPayout` at issuance;
- withdrawals cannot touch locked exposure;
- only the bound buyer can open a claim;
- one coverage can create at most one claim;
- claims bind exactly one evidence hash;
- settlement requires the immutable evaluator's EIP-712 signature;
- approved payouts are bounded by `maxPayout`;
- nonces are single-use and terminal claims cannot be paid twice;
- payout accounting is updated before the external transfer and settlement is reentrancy guarded;
- failed payouts revert the entire state transition; and
- unused expired coverage releases its lock exactly once.

## Product surfaces

The Next.js app under `web/` contains the complete user-facing product:

- `/` — product and RWA value proposition
- `/app` — operational Mainnet workspace for reserve, coverage, evidence, claims, and settlement
- `/demo` — controlled lifecycle walkthrough for fast product understanding
- `/proof` — current production lifecycle verifier with the earlier contract retained as historical proof
- `/reserve` — public reserve lookup
- `/faq` — product and trust-model answers
- `/privacy` and `/terms` — supporting product pages

## Architecture

```text
Merchant / buyer wallet
        │
        ├── deposit / issue / open / resolve / withdraw
        ▼
BOT Chain Mainnet · chain 677
WarrantyReserve.sol
        ▲
        │ EIP-712 bounded decision
        │
VPS evaluator API · HTTPS
        ▲
        │ authorized, claim-bound evidence
        │
Deterministic policy ── optional Groq proposal layer
        │
Durable evidence store · atomic, fail-closed

Vercel frontend ──HTTPS──► VPS evaluator API
```

Important implementation paths:

- `contracts/WarrantyReserve.sol` — reserve, coverage, and settlement contract
- `scripts/evaluator/` — evaluator policy/schema/signing implementation
- `parity/evaluator.parity.test.ts` — evaluator parity checks
- `web/app/api/evidence/route.ts` — authenticated evidence intake
- `web/app/api/evaluate/route.ts` — bounded signed-decision endpoint
- `web/lib/evidenceStore.ts` — fail-closed durable evidence persistence
- `web/lib/evaluateAuth.ts` — canonical authorization messages and signer recovery
- `web/components/AppConsole.tsx` — wallet workflow
- `web/lib/currentProof.ts` — current production lifecycle receipt manifest
- `web/lib/currentProofEngine.ts` — live current-deployment proof verification

## Safe deployment gate

A clone does not enable writes merely by having a valid contract address. Write mode requires all of the following:

1. `NEXT_PUBLIC_RESVYN_ADDRESS` points at a non-archived Mainnet deployment.
2. `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR` pins the expected immutable signer.
3. The app reads the live `evaluatorSigner` and it matches the pin.
4. `NEXT_PUBLIC_RESVYN_OPERATIONAL=1` is explicitly set.
5. The evaluator service has the matching server-only `RESVYN_EVALUATOR_KEY`.
6. The evaluator independently verifies its server key against the on-chain immutable signer before signing.
7. Evidence persistence is durable and writable.

Production has passed these gates. If any gate fails, the client becomes read-only or the evaluator refuses to sign.

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

Copy `web/.env.example` to `web/.env.local` for local configuration. The example remains fail-closed by default.

## Verification and CI

CI gates:

- repository secret-signature hygiene;
- Hardhat compilation and contract tests;
- evaluator parity tests;
- contract dependency audit;
- frontend linting and TypeScript checks;
- unit and API route integration tests;
- production Next.js build; and
- production web dependency audit.

The contract suite covers reserve boundaries, multi-merchant isolation, coverage expiry, claim authorization, signature binding, payout rollback, replay resistance, and reentrancy behavior.

## Current operational status

- [x] Hardened WarrantyReserve deployed to BOT Chain Mainnet
- [x] Source verified on BOTScan
- [x] Immutable evaluator signer matches the protected production evaluator key
- [x] Durable VPS evaluator backend online over HTTPS
- [x] Evidence storage survives service restarts and fails closed on corruption
- [x] Production frontend points at the current deployment and evaluator API
- [x] Production operational gate enabled
- [x] Fresh merchant + separate buyer full Mainnet lifecycle completed
- [x] Real evaluator-authorized `0.0005 BOT` buyer payout completed
- [x] Fresh merchant reserve reconciled to `0 / 0 / 0`
- [x] Replay and over-cap negative proofs passed
- [x] Current proof receipts captured for independent verification
- [ ] Record the final 60–120 second product demo
- [ ] Ensure judging access to the private repository for the evaluation window

## Current limitations

Resvyn is hackathon-stage software and should be treated accordingly:

- the evaluator signer is immutable, so signer loss requires migration to a new deployment;
- physical-world damage is attested, not independently proven by an oracle;
- the production evidence adapter is durable single-host storage rather than a replicated database;
- rate limiting is process-local; and
- no independent production security audit has been completed.

## Roadmap

1. merchant checkout/API integration so coverage can be issued directly from real sales;
2. optional independent inspection/oracle adapters for higher-value claims;
3. replicated evidence and rate-limit infrastructure for multi-instance hosting;
4. evaluator-key migration design for production operations; and
5. external contract/security review before material value is placed at risk.

## License

MIT, see [`LICENSE`](LICENSE).
