import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { evaluateAndSign as scriptsEvaluateAndSign } from "../scripts/evaluator/service.js";
import { evaluateAndSign as webEvaluateAndSign } from "../web/lib/evaluator.server.ts";

// REV-010 parity test: the web evaluator (web/lib/evaluator.server.ts) is a
// port of the scripts evaluator (scripts/evaluator/*). The contract-critical
// logic - schema, policy, EIP-712 binding, and signing - must produce
// byte-identical decisions from both adapters, or rehearsal and production
// would drift. This test signs the same fixtures through both and compares
// the exact decision fields and the resulting signature.
//
// Lives in the ROOT test suite (not web/) because it imports root evaluator
// sources; the web CI job installs only web/node_modules.

const SIGNER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const account = privateKeyToAccount(SIGNER_KEY);

const VERIFIER = "0x414592d2313d233b673b1f97803c261355ccd996" as `0x${string}`;
const CLAIMANT = "0xAbf039f2DC31084F5E0713708C96068126a043e9" as `0x${string}`;
const EVIDENCE_HASH = ("0x" + "11".repeat(32)) as `0x${string}`;

const fixture = {
  chainId: 677n,
  verifier: VERIFIER,
  claimId: 1n,
  coverageId: 1n,
  claimant: CLAIMANT,
  evidenceHash: EVIDENCE_HASH,
  nonce: 1n,
  maxPayout: parseEther("0.001"),
  asOf: 1755003600n,
  decisionTtl: 3600n,
};

const goodEvidence = {
  productMatches: true,
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  issuedAt: 1755000000n,
  requestedAmount: parseEther("0.0005"),
  evidenceHash: EVIDENCE_HASH,
};

function binding(overrides: Record<string, unknown> = {}) {
  return { ...fixture, ...overrides };
}

describe("evaluator parity scripts vs web (REV-010)", async () => {
  it("produces the identical signed decision for an approval fixture", async () => {
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(goodEvidence, binding(), account),
      webEvaluateAndSign(goodEvidence, binding(), account),
    ]);

    assert.deepEqual(script.model, web.model);
    assert.deepEqual(script.decision, web.decision);
    // Same key, same EIP-712 type hash, same domain, same message: the
    // signature must be byte-identical, proving the web port did not drift.
    assert.equal(script.signature, web.signature);
    assert.equal(script.signer, web.signer);
  });

  it("produces identical decisions for a rejection fixture", async () => {
    const rejected = { ...goodEvidence, damageEligible: false };
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(rejected, binding(), account),
      webEvaluateAndSign(rejected, binding(), account),
    ]);
    assert.deepEqual(script.decision, web.decision);
    assert.equal(script.signature, web.signature);
    assert.equal(script.model.decision, "REJECT");
  });

  it("agrees at the cap boundary (approval exactly at maxPayout)", async () => {
    const atCap = { ...goodEvidence, requestedAmount: parseEther("0.001") };
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(atCap, binding(), account),
      webEvaluateAndSign(atCap, binding(), account),
    ]);
    assert.equal(script.decision.amount, web.decision.amount);
    assert.equal(script.decision.amount, parseEther("0.001"));
    assert.equal(script.signature, web.signature);
  });

  it("both agree on an over-cap request (policy REJECT, amount 0)", async () => {
    const overCap = { ...goodEvidence, requestedAmount: parseEther("0.002") };
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(overCap, binding(), account),
      webEvaluateAndSign(overCap, binding(), account),
    ]);
    assert.deepEqual(web.model, script.model);
    assert.equal(web.model.decision, "REJECT");
    assert.equal(web.model.reasonCode, "AMOUNT_EXCEEDS_CAP");
    assert.equal(web.decision.amount, 0n);
    assert.equal(web.signature, script.signature);
  });

  it("both encode the same model version hash and decision expiry", async () => {
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(goodEvidence, binding(), account),
      webEvaluateAndSign(goodEvidence, binding(), account),
    ]);
    assert.equal(web.decision.modelVersion, script.decision.modelVersion);
    assert.equal(web.decision.expiry, script.decision.expiry);
    assert.equal(web.decision.expiry, fixture.asOf + fixture.decisionTtl);
  });

  it("both reject a future-dated claim as stale (REV-001r3)", async () => {
    const futureDated = { ...goodEvidence, issuedAt: fixture.asOf + 3600n }
    const [script, web] = await Promise.all([
      scriptsEvaluateAndSign(futureDated, binding(), account),
      webEvaluateAndSign(futureDated, binding(), account),
    ])
    assert.equal(web.model.decision, "REJECT")
    assert.equal(web.model.reasonCode, "STALE_CLAIM")
    assert.deepEqual(script.model, web.model)
    assert.equal(script.signature, web.signature)
  })

  it("both refuse a mismatched evidence hash", async () => {
    const wrongHash = { ...goodEvidence, evidenceHash: ("0x" + "22".repeat(32)) as `0x${string}` };
    await assert.rejects(scriptsEvaluateAndSign(wrongHash, binding(), account), /does not match/);
    await assert.rejects(webEvaluateAndSign(wrongHash, binding(), account), /does not match/);
  });
});
