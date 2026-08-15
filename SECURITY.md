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
- **Evidence authority (REV-001):** `/api/evaluate` accepts evidence only as
  an EIP-191 attestation signed by the on-chain claim claimant or coverage
  merchant, bound to the live claim/coverage/chain and the on-chain evidence
  hash. An anonymous caller cannot obtain a signature; a caller cannot tamper
  with attested fields or amounts without invalidating the signature; a
  cross-claim attestation is refused.
- **Fail-closed evaluation (REV-006):** when the optional Groq brain is
  configured and the provider fails (HTTP error, timeout, malformed output,
  schema failure), no signature is returned. An outage pauses the Groq path;
  it never silently approves.
- **Deployment manifest (REV-002):** the archived Mainnet proof instance is
  read-only. Writes are enabled only when `NEXT_PUBLIC_RESVYN_ADDRESS` points
  at a non-proof contract AND `NEXT_PUBLIC_RESVYN_OPERATIONAL=1` is set, and
  the evaluate route refuses to sign for the proof instance regardless.
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
