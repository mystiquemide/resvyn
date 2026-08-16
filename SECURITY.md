# Security

Resvyn is a pre-production protocol implementation. The contract and web
application are heavily test-covered, but the system has not received an
independent production audit. The recorded BOT Chain Mainnet proof deployment
is archived and read-only. A separate operational deployment is required for
new live coverage.

## Reporting a vulnerability

Please do not disclose an exploitable issue in a public issue. Use GitHub's
private vulnerability reporting flow when available, or contact the repository
owner privately through the contact information on their GitHub profile.

A useful report includes the affected component, reproduction steps, impact,
and any transaction or calldata required to demonstrate the issue.

## Security invariants

The contract enforces these properties on chain:

- Coverage cannot be issued unless the merchant has enough free reserve to
  cover its full declared maximum payout.
- Product and receipt commitments must be non-zero at issuance.
- A merchant can withdraw only reserve that is not locked behind coverage.
- Only the buyer bound to a coverage can open its claim.
- One coverage can create at most one claim.
- A claim is bound to one evidence hash.
- Settlement decisions are EIP-712 signed and bound to the chain, verifier,
  claim, coverage, claimant, evidence hash, amount, result, expiry and nonce.
- The evaluator signer is immutable for a deployment.
- A decision nonce can be consumed only once.
- An approved payout cannot exceed the coverage maximum.
- Payout accounting is updated before the external transfer and the settlement
  function is reentrancy guarded. A failed payout reverts the entire state
  transition.
- Unused expired coverage can release its lock exactly once.

## Evaluator trust boundary

`RESVYN_EVALUATOR_KEY` is a settlement authority. It belongs only in the server
environment and must never be committed or shipped to the browser. If the key
is compromised, an attacker can sign bounded decisions for open claims. If it
is lost, an open claim can remain locked because the contract intentionally has
no admin signer-rotation path.

For operational deployments, the server derives the evaluator address from the
configured key and verifies it against the contract's immutable
`evaluatorSigner`. The frontend also requires a pinned
`NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR` before enabling writes.

## Evidence model

Resvyn does not claim to independently prove physical-world damage.

The claimant or merchant attests one evidence snapshot. The server verifies
that the canonical content hash equals the claim's on-chain `evidenceHash` and
that the signer is the claim owner or coverage merchant. Product and receipt
matches are derived server-side against the hashes committed at coverage
issuance. Damage eligibility, evidence completeness and file-integrity flags
remain attestations supplied by the authorized party.

`POST /api/evaluate` accepts claim references and fresh authorization, not a
second mutable copy of the evidence. Missing, stale, forged or cross-claim data
fails closed without an evaluator signature.

If the optional Groq decision layer is enabled, provider timeout, HTTP failure,
malformed output or schema failure also fails closed. Provider failure never
silently becomes approval.

## Evidence persistence

Evidence records are first-write-wins, claim-bound and persisted before an API
success is returned. The default store is a local file configured through
`RESVYN_EVIDENCE_STORE_PATH`.

An operational host therefore needs durable writable storage. Multi-instance
hosting must use shared storage or replace the local adapter with a shared data
store. Ephemeral serverless filesystems are not an acceptable persistence layer
for the live evidence path.

Unauthenticated evidence-status reads expose only the attested state, hash and
derived summary, not the raw evidence content.

## Rate limiting

The API has per-client, per-claim and global budgets. Proxy-derived client
identity is trusted only when `RESVYN_TRUST_PROXY=1` is explicitly configured.
The current limiter is process-local, so horizontally scaled production hosting
needs a shared rate-limit backend.

## Deployment requirements

Before enabling writes on a new deployment:

1. Deploy the current contract to BOT Chain Mainnet.
2. Verify the source on BOTScan.
3. Confirm the immutable evaluator signer matches the server key.
4. Pin the same signer in `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR`.
5. Set `NEXT_PUBLIC_RESVYN_OPERATIONAL=1` only after those checks pass.
6. Use durable evidence storage and a production secret manager.
7. Run the full CI suite and a live end-to-end rehearsal with a small reserve.

## Release gates

CI compiles and tests the contracts, checks evaluator parity, lints and type
checks the web app, runs unit and route-integration tests, creates a production
build and audits production web dependencies.

Any contract or evaluator-signing change should receive the same full suite and
a fresh Mainnet deployment review before it is considered operational.
