# Security

Resvyn is hackathon-stage protocol software. The contract and web application are heavily test-covered, but the system has not received an independent production security audit. Do not place material value in a Resvyn deployment without a separate review and production-grade operational controls.

## Current Mainnet status

The hardened `WarrantyReserve` is deployed, source-verified, operational, and has completed a disposable end-to-end lifecycle on BOT Chain Mainnet:

- Contract: `0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe`
- Immutable evaluator signer: `0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0`
- Deployment block: `19898630`
- Deploy tx: `0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49`
- Source: verified on BOTScan
- Production evaluator API: `https://resvyn-api.159.69.241.122.sslip.io`
- Evidence persistence: durable VPS filesystem, disk-first atomic writes, fail-closed load/write behavior

Production has the expected evaluator pinned and the explicit operational flag enabled. Browser write controls still require a connected wallet on BOT Chain Mainnet and a live evaluator signer that matches the pin. The evaluator independently derives its signer from the protected server key and compares it with the contract before producing a settlement signature.

A fresh merchant and separate buyer completed the production lifecycle: `0.001 BOT` reserve deposit, `0.0005 BOT` buyer-bound coverage, evidence-bound claim, durable evidence intake, evaluator-authorized `0.0005 BOT` payout, and final fresh-merchant reserve reconciliation to `0 / 0 / 0`. Replay and over-cap simulations rejected with `NonceAlreadyUsed` and `InsufficientFreeReserve` respectively.

The contract also contains a separate disposable `0.001 BOT` smoke reserve belonging to another merchant. That position was intentionally left untouched and is not part of the fresh lifecycle accounting.

The earlier deployment at `0x414592d2313d233b673b1f97803c261355ccd996` is retained only as historical, read-only lifecycle evidence. Its original evaluator key is no longer an operational signing authority and the application refuses to use that address as an operational deployment.

## Reporting a vulnerability

Please do not disclose an exploitable issue in a public issue. Use GitHub's private vulnerability reporting flow when available, or contact the repository owner privately through the contact information on their GitHub profile.

A useful report includes the affected component, reproduction steps, impact, and any transaction or calldata required to demonstrate the issue.

## Security invariants

The contract enforces these properties on chain:

- Coverage cannot be issued unless the merchant has enough free reserve to cover its full declared maximum payout.
- Product and receipt commitments must be non-zero and cannot use the client's empty-placeholder commitment.
- A merchant can withdraw only reserve that is not locked behind coverage.
- Zero-value deposits and withdrawals are rejected.
- Only the buyer bound to a coverage can open its claim.
- One coverage can create at most one claim.
- A claim is bound to one evidence hash.
- Settlement decisions are EIP-712 signed and bound to the chain, verifier, claim, coverage, claimant, evidence hash, amount, result, expiry, and nonce.
- The evaluator signer is immutable for a deployment.
- A decision nonce can be consumed only once.
- An approved payout cannot exceed the coverage maximum.
- Payout accounting is updated before the external transfer and settlement is reentrancy guarded. A failed payout reverts the entire state transition.
- Unused expired coverage can release its lock exactly once.

The completed current-deployment lifecycle exercises the reserve lock, claim binding, approved payout, nonce consumption, and reserve reconciliation paths against Mainnet state. It is evidence of the deployed behavior, not a substitute for an independent audit.

## Evaluator trust boundary

`RESVYN_EVALUATOR_KEY` is a settlement authority. It belongs only in a server secret store and must never be committed, logged, pasted into public tooling, or shipped to the browser.

If the key is compromised, an attacker can sign bounded decisions for open claims. The contract still enforces claim binding, payout cap, chain/verifier binding, and replay checks, but the signer remains privileged settlement authority.

If the key is lost, an open claim can remain locked because the current contract intentionally has no admin signer-rotation path. Recovery requires migration to a new deployment. Production backups therefore need encrypted, access-controlled secret management.

For operational deployments, the server derives the evaluator address from the configured key and verifies it against the contract's immutable `evaluatorSigner`. A mismatch fails closed with no decision signature.

The frontend independently requires a pinned `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR`, reads the live on-chain signer, and exposes writes only when the two match and `NEXT_PUBLIC_RESVYN_OPERATIONAL=1` is set.

## Evidence model

Resvyn does not claim to independently prove physical-world damage.

The claimant or merchant attests one evidence snapshot. The server verifies that the canonical content hash equals the claim's on-chain `evidenceHash` and that the signer is the claim owner or coverage merchant. Product and receipt matches are derived server-side against the hashes committed at coverage issuance. Damage eligibility, evidence completeness, and file-integrity flags remain attestations supplied by the authorized party.

`POST /api/evaluate` accepts claim references and fresh authorization, not a second mutable copy of the evidence. Missing, stale, forged, cross-claim, or misbound data fails closed without an evaluator signature.

If the optional Groq proposal layer is enabled, provider timeout, HTTP failure, malformed output, or schema failure also fails closed. Provider failure never silently becomes approval.

The chain proves that settlement was authorized by the deployment's immutable evaluator signer. It does not independently prove which off-chain model produced the proposal.

### Authorization-message canonicalization

Evidence intake and evaluation authorization use EIP-191 messages. The verifier address is canonicalized with viem `getAddress()` before it enters the signed message. This makes helper-generated messages byte-identical whether an integration begins with a lowercase or checksummed contract address. The server still compares verifier addresses case-insensitively after parsing and authorizes only the on-chain claimant or coverage merchant.

## Evidence persistence

Evidence records are first-write-wins, claim-bound, and persisted before an API success is returned. Production uses a durable VPS path configured through `RESVYN_EVIDENCE_STORE_PATH`.

The implementation writes the new state before acknowledging intake. If loading or persistence fails, the store is treated as unavailable and the evaluator signs nothing. A corrupt store is not silently replaced by an empty one.

The production persistence path was restart-tested before operational mode was enabled, and the final lifecycle's evidence record survived a full evaluator-service restart before settlement.

Multi-instance hosting must use shared storage or replace the local adapter with a shared data store. Ephemeral serverless filesystems are not an acceptable persistence layer for the live evidence path.

Unauthenticated evidence-status reads expose only the attested state, hash, derived summary, submitter, and timestamp required by the browser flow, not the raw evidence content.

## Rate limiting

The API has per-client, per-claim, and global budgets. Proxy-derived client identity is trusted only when `RESVYN_TRUST_PROXY=1` is explicitly configured. The current limiter is process-local, so horizontally scaled hosting needs a shared rate-limit backend.

CORS is not treated as authentication. Cross-origin production access is restricted at the API boundary, while wallet attestations and live on-chain authorization remain the security checks for evidence and evaluation.

## Write-enable deployment gate

A valid contract address alone is never enough to enable transactions.

Before enabling writes on the current or any future deployment:

1. Deploy the intended contract to BOT Chain Mainnet.
2. Verify the source on BOTScan.
3. Confirm the immutable on-chain evaluator signer.
4. Set `NEXT_PUBLIC_RESVYN_ADDRESS` to that exact deployment.
5. Set `NEXT_PUBLIC_DEPLOY_START_BLOCK` to that deployment block.
6. Pin the immutable signer in `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR`.
7. Provision the matching server-only `RESVYN_EVALUATOR_KEY`.
8. Provision durable writable evidence storage with `RESVYN_EVIDENCE_STORE_PATH` or a replacement shared adapter.
9. Confirm the server-derived signer equals the live contract signer.
10. Run the full CI suite and a disposable end-to-end Mainnet rehearsal.
11. Only then set `NEXT_PUBLIC_RESVYN_OPERATIONAL=1`.

Production has completed that sequence. The client checks the public deployment manifest and live signer before exposing write actions. The evaluator performs its own authoritative signer, claim, evidence, and policy checks before producing a settlement signature. If any server-side gate fails, signing fails closed even when the public operational flag remains enabled.

## Key handling

- Never commit deployer, merchant, buyer, or evaluator private keys.
- Never place private keys in `NEXT_PUBLIC_*` variables.
- Never reuse a key that has been exposed in chat, logs, screenshots, terminal history, CI output, or another untrusted surface.
- Use dedicated deployment and evaluator identities rather than a valuable personal wallet.
- Keep production evaluator backups encrypted and access-controlled.
- Rotate to a new deployment if the immutable evaluator key is lost or compromised.
- Disposable lifecycle wallets must be treated as test identities, not long-term custody accounts.

## Release gates

CI compiles and tests the contracts, checks evaluator parity, lints and type-checks the web app, runs unit and route-integration tests, creates a production build, checks tracked files for common secret signatures, and audits production web dependencies.

Any contract or evaluator-signing change should receive the same full suite and a fresh deployment review before it is considered operational. Presentation-only proof updates do not alter the settled Mainnet receipts and must not rewrite or hide historical proof data.

## Known limitations

- No independent production audit has been completed.
- The evaluator signer is immutable and has no emergency rotation path.
- Physical-world damage remains attested unless an external inspection/oracle adapter is added.
- The production evidence persistence adapter is designed for one durable host rather than replicated multi-region storage.
- The current rate limiter is process-local.
- The public proof can verify on-chain receipts and the persisted evidence-status record, but cannot independently reconstruct the off-chain model invocation from chain data alone.
