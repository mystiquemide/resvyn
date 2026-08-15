# Security Policy

## Reporting a vulnerability

This is a hackathon-grade research prototype, not a production financial
system. Do not send real BOT to any deployment other than the recorded,
already-settled Mainnet proof.

If you find a security issue:

1. **Do not open a public issue** for the details.
2. Email the maintainer via the GitHub contact address on the repository
   owner profile, or open a private vulnerability report through GitHub's
   "Report a vulnerability" flow on this repository.
3. Include: affected component, a minimal reproduction, expected vs actual
   behavior, and impact assessment.

You will receive an acknowledgement within 7 days. Please allow 90 days
before public disclosure unless coordinated otherwise.

## Trust model

- **Evaluator key** (`RESVYN_EVALUATOR_KEY`) is the settlement authority.
  It is server-env only, never committed, never in the client bundle.
  Compromise of this key lets an attacker sign any decision for any open
  claim, up to each coverage's cap. It is held by the operator.
- **Evidence authority (REV-001):** `/api/evaluate` accepts no evidence
  fields and no amount. Evidence is attested once at `POST /api/evidence` by
  the on-chain claim claimant or coverage merchant; the server requires the
  content's canonical hash to equal the claim's on-chain `evidenceHash`, so
  the chain commitment verifiably commits to the server-seen content. The
  record is stored server-side (first-write-wins, immutable) and evaluation
  derives all signals and the payout from it. A missing record, a stale or
  forged authorization, or a cross-claim reference returns no signature.
- **Exact deployment gate (REV-002):** the route reads the contract's
  immutable `evaluatorSigner` and requires it to equal the address derived
  from `RESVYN_EVALUATOR_KEY`. The archived Mainnet proof instance is
  read-only: the route refuses to sign for it, and the app renders write
  controls only for a non-proof address with `NEXT_PUBLIC_RESVYN_OPERATIONAL=1`
  and (when pinned) a matching `NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR`.
- **Fail-closed evaluation (REV-006):** when the optional Groq brain is
  configured and the provider fails (HTTP error, timeout, malformed output,
  schema failure), no signature is returned. An outage pauses the Groq path;
  it never silently approves.
- **Rate limits (REV-005):** per-client only behind a declared trusted proxy
  (`RESVYN_TRUST_PROXY=1`); per-claim budgets use canonical ids; a global
  budget bounds total traffic; blocked requests never consume the global
  allowance for other clients.
- **Contract:** the evaluator signer is immutable (rotation = new
  deployment). Claims are terminal, nonces are single-use, and the winning
  invariant guards (insufficient free reserve, withdrawal above free reserve,
  post-expiry claim opening) revert with explicit custom errors.

## Known advisory tracking (REV-015)

The root development toolchain (Hardhat/ethers/viem) reports Low-severity
`npm audit` findings, including the transitive `elliptic` cryptographic
advisory with **no upstream fix currently available**. These packages are
development-only (build/test/deployment tooling), are not shipped to the web
runtime, and the web production tree audits clean (`npm audit --omit=dev`).
Status: monitored; re-check on each dependency bump; owner: repository
maintainer; next review: on the next root `npm ci` upgrade.

## Release gates

- Web: lint, type check, unit + route integration tests, production build,
  and `npm audit --omit=dev` (CI enforces these).
- Contracts: `hardhat compile` and `hardhat test` (CI enforces these).
- Any change to `contracts/` or the evaluator signing path requires the
  full contract suite, the route trust-boundary tests, and the evaluator
  parity test to pass.
