import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, parseEther, toHex } from "viem";

import {
  evaluateAndSign,
  RESULT,
  type DecisionBinding,
  type TypedDataSigner,
} from "../scripts/evaluator/service.js";
import type { ClaimEvidence } from "../scripts/evaluator/policy.js";

// End-to-end integration: the evaluator SERVICE (not a hand-built decision)
// produces the signed EIP-712 payload, and the real WarrantyReserve contract
// settles it. This is the proof that the off-chain evaluator and the on-chain
// verifier agree byte-for-byte: same domain, same type, same field binding.
// It closes the loop the plan calls the winning mechanism, "a bounded AI
// decision controls settlement," without a hardcoded result.

describe("WarrantyReserve x evaluator service (settlement integration)", async function () {
  const { viem } = await network.create();

  const PRODUCT_HASH = keccak256(toHex("resvyn-int-product"));
  const RECEIPT_HASH = keccak256(toHex("resvyn-int-receipt"));
  const EVIDENCE_HASH = keccak256(toHex("resvyn-int-evidence"));
  const MODEL_VERSION = "resvyn-eval-v1";
  const FUTURE_EXPIRY = 2_000_000_000n;

  async function seeded() {
    const wallets = await viem.getWalletClients();
    const merchant = wallets[0];
    const claimant = wallets[1];
    const relayer = wallets[2];
    const evaluator = wallets[9];
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    const reserve = await viem.deployContract("WarrantyReserve", [
      evaluator.account.address,
    ]);
    const reserveAsClaimant = await viem.getContractAt(
      "WarrantyReserve",
      reserve.address,
      { client: { wallet: claimant } },
    );
    const reserveAsRelayer = await viem.getContractAt(
      "WarrantyReserve",
      reserve.address,
      { client: { wallet: relayer } },
    );

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);

    const now = BigInt((await publicClient.getBlock()).timestamp);

    const binding: DecisionBinding = {
      chainId: BigInt(chainId),
      verifier: reserve.address,
      claimId: 1n,
      coverageId: 1n,
      claimant: claimant.account.address,
      evidenceHash: EVIDENCE_HASH,
      nonce: 1n,
      maxPayout: parseEther("1"),
      asOf: now,
      decisionTtl: 3600n,
    };

    // The wallet client can sign typed data; adapt it to the service's signer.
    // Typed as TypedDataSigner so the adapter matches the service's contract
    // exactly (the wallet client's own signTypedData carries a much wider
    // generic that does not structurally reduce to this shape).
    const signer: TypedDataSigner = {
      address: evaluator.account.address,
      signTypedData: (args) =>
        evaluator.signTypedData({ ...args, account: evaluator.account }),
    };

    function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
      return {
        productMatches: true,
        damageEligible: true,
        evidenceComplete: true,
        fileIntegrityOk: true,
        issuedAt: now - 3600n,
        requestedAmount: parseEther("1"),
        evidenceHash: EVIDENCE_HASH,
        ...overrides,
      };
    }

    return {
      publicClient,
      reserve,
      reserveAsRelayer,
      claimant,
      binding,
      signer,
      evidence,
    };
  }

  it("settles an evaluator-signed APPROVE: pays the claimant and releases the lock", async () => {
    const { publicClient, reserve, reserveAsRelayer, claimant, binding, signer, evidence } =
      await seeded();

    const out = await evaluateAndSign(evidence(), binding, signer, {
      modelVersion: MODEL_VERSION,
    });
    assert.equal(out.decision.result, RESULT.APPROVE);

    const before = await publicClient.getBalance({ address: claimant.account.address });
    await reserveAsRelayer.write.resolveClaim([out.decision, out.signature]);
    const after = await publicClient.getBalance({ address: claimant.account.address });

    // Payout landed in the claimant, exactly the approved amount.
    assert.equal(after - before, parseEther("1"));

    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 2); // Approved
    assert.equal(claim.paidAmount, parseEther("1"));
    assert.equal(await reserve.read.isNonceUsed([1n]), true);

    // Lock released: merchant balance 5 - 1 = 4, all free.
    const acct = await reserve.read.reserveOf([
      getAddress((await viem.getWalletClients())[0].account.address),
    ]);
    assert.equal(acct[1], 0n); // locked
    assert.equal(acct[0], parseEther("4")); // balance
    assert.equal(acct[2], parseEther("4")); // free
  });

  it("settles an evaluator-signed REJECT: no payout, lock released, claim Rejected", async () => {
    const { publicClient, reserve, reserveAsRelayer, claimant, binding, signer, evidence } =
      await seeded();

    // Ineligible damage -> the policy REJECTs; the service signs a result=2.
    const out = await evaluateAndSign(evidence({ damageEligible: false }), binding, signer, {
      modelVersion: MODEL_VERSION,
    });
    assert.equal(out.decision.result, RESULT.REJECT);
    assert.equal(out.decision.amount, 0n);

    const before = await publicClient.getBalance({ address: claimant.account.address });
    await reserveAsRelayer.write.resolveClaim([out.decision, out.signature]);
    const after = await publicClient.getBalance({ address: claimant.account.address });

    assert.equal(after - before, 0n); // no payout on rejection
    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 3); // Rejected
    assert.equal(claim.paidAmount, 0n);
    assert.equal(await reserve.read.isNonceUsed([1n]), true);
  });
});
