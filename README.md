# Resvyn

**Fund the warranty before you issue it.**

Resvyn is a merchant-funded warranty reserve on BOT Chain. A merchant locks
native BOT, issues buyer-bound coverage whose full maximum payout is reserved
upfront, and a bounded AI-assisted evaluator signs EIP-712 decisions that
settle claims directly from the locked reserve.

> **Winning invariant: "No funded reserve, no valid coverage."**

## Status

- **Mainnet proof: LIVE and independently verified.** The recorded proof
  lifecycle (deploy, deposit, issue, open, resolve/pay, withdraw) ran on BOT
  Chain Mainnet (chain 677) and every receipt reconciles to the current state.
- **Proof deployment is READ-ONLY (REV-002).** The app refuses all writes
  against the archived proof instance. New operational writes require a fresh
  deployment verified through the manifest gate described below.
- **Not an audited production system.** This is a hackathon-grade prototype
  with a strong contract core. See `SECURITY.md` and the "Known limitations"
  section.

## 30-second proof

1. Open the live proof page: **`/proof`** (in the deployed app) — it re-reads
   the contract, the six Mainnet receipts, and the reconciled state live.
2. Contract: [`0x414592d2313d233b673b1f97803c261355ccd996`](https://scan.botchain.ai/address/0x414592d2313d233b673b1f97803c261355ccd996)
   on BOT Chain Mainnet (chain 677).
3. Payout transaction (`ClaimPaid`, 0.001 BOT):
   [`0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d`](https://scan.botchain.ai/tx/0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d)
4. Negative checks (call-level, no state change):
   - Over-cap issuance reverts `InsufficientFreeReserve`.
   - Replayed signed settlement reverts `NonceAlreadyUsed`.

## How it works

```
Merchant deposits BOT ──► reserve (free)
Merchant issues coverage ──► locks maxPayout (free -= maxPayout)
Claimant opens claim ──► binds claimant + evidence hash (one claim per coverage)
Evaluator signs EIP-712 decision ──► approved → pay claimant, release lock
                                  └── rejected → release lock, no payout
Coverage expires unused ──► expireCoverage releases the lock exactly once
```

- **Reserve accounting:** issuance rejects `maxPayout > freeReserve`;
  withdrawal rejects amounts above `freeReserve` — the two winning-invariant
  guards.
- **Claims:** one terminal claim per coverage, claimant-only opening,
  evidence-hash binding, nonce replay protection, effects-before-interactions
  payout accounting, reentrancy guard.
- **Expiry (REV-003):** claims cannot be opened after coverage expiry; an
  unused, past-expiry coverage can be permissionlessly expired, releasing its
  full lock exactly once. A claim opened before expiry remains settleable
  (documented grace rule).

## Why BOT Chain

- The entire proof is a real Mainnet lifecycle: native BOT reserve, on-chain
  events, public receipts, live RPC verification.
- Optional BOT Chain EOA Paymaster client exists (`scripts/paymaster.ts`) but
  is **inert unless a real endpoint is configured** — as of this writing no
  public chain-677 endpoint is available. It is not presented as operational.

## Architecture

```
Browser (Wagmi/Viem) ──► /api/evaluate (Next.js server)
        │                      │ reads live claim/coverage state
        │ evidence attestation │ (claimant/merchant signs EIP-191)
        ▼                      ▼
BOT Chain WarrantyReserve ◄── evaluator key signs EIP-712 decision
```

- `contracts/WarrantyReserve.sol` — the reserve/claim contract (Solidity
  0.8.28, OpenZeppelin EIP712/ECDSA/ReentrancyGuard).
- `scripts/evaluator/` — original policy/schema/signing service (used by
  rehearsal).
- `web/lib/evaluator.server.ts` — web port of the evaluator; **parity-tested
  byte-for-byte against the scripts version** (`web/lib/evaluator.parity.test.ts`).
- `web/app/api/evaluate/route.ts` — signed-decision endpoint.
- `web/components/AppConsole.tsx` — wallet console (read-only for archived
  proof instance).
- `web/lib/proofEngine.ts` — live proof verification.

## Security / trust model

- The evaluator signing key lives only in server env (`RESVYN_EVALUATOR_KEY`).
- `/api/evaluate` signs **only** for an authenticated claimant or merchant
  (EIP-191 attestation over every evidence field plus the claim binding),
  binds the decision to live on-chain state, and **fails closed** when the
  evidence hash, signer, amount, or provider result is invalid (REV-001,
  REV-006).
- Rate limits: per-client (only behind a declared trusted proxy), per-claim,
  and global (REV-005).
- See `SECURITY.md` for the full model and reporting path.

## Run locally

Prerequisites: Node 22+, npm.

```bash
# Contracts (Hardhat)
npm ci
npx hardhat compile
npx hardhat test

# Web app (Next.js)
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The web app reads from the Mainnet proof contract by default and renders it
**read-only**. To enable writes against an operational deployment:

```bash
NEXT_PUBLIC_RESVYN_ADDRESS=<operational-contract-address> \
NEXT_PUBLIC_RESVYN_OPERATIONAL=1 \
npm run dev
```

Server env for the evaluator route (never committed): `RESVYN_EVALUATOR_KEY`
(required to sign), `RESVYN_GROQ_KEY` (optional brain), `RESVYN_RATE_LIMIT_*`,
`RESVYN_TRUST_PROXY`.

## Rehearsal

`scripts/rehearse.ts` runs the full lifecycle against BOT Testnet (968) by
default and refuses unknown chains (REV-008). See its header for env vars.

## Verification

- Contract suite: 100+ Hardhat behavior/invariant tests, including expiry
  lifecycle (REV-003), replay, cap boundaries, payout rollback, reentrancy.
- Web suite: 30+ Vitest tests covering evaluator policy/schema, Groq
  fail-closed, rate limiting, route trust boundary (auth, forgery, staleness,
  archived gate), and evaluator parity.
- CI: lint, type check, tests, production build, and `npm audit --omit=dev`
  for the web app; compile + tests for the contracts (`.github/workflows/ci.yml`).

## Known limitations

- The Mainnet deployment is a **proof instance**; its immutable evaluator
  signer is no longer in use, so it is frozen read-only.
- Evidence is attested by the claimant/merchant under their own key; the
  evaluator verifies structure and policy, not physical-world truth.
- Rate limiter and evidence attestation are stateless/single-instance; a
  multi-instance deployment needs a shared store.
- Root dev-tooling advisories (Low severity, no upstream fix) are tracked in
  `SECURITY.md`.

## License

MIT — see [LICENSE](LICENSE).
