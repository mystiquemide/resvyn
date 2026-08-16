import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

// REV-003: coverage expiry is enforced and unused exposure is recoverable.
//
// The coverage window is a lifecycle invariant, not metadata:
//   - openClaim reverts when the coverage has expired (BR-005 + expiry rule);
//   - an unused, past-expiry coverage can be permissionlessly expired exactly
//     once via expireCoverage, releasing the full maxPayout lock (REV-003);
//   - a coverage with an already-open claim is NOT expirable: the claim was
//     opened while the coverage was active and remains settleable by a valid
//     evaluator decision (documented grace rule), so the lock is only
//     released through settlement;
//   - the Expired status is terminal, so the lock can never be released
//     twice (BR-011 accounting invariant).

describe("WarrantyReserve coverage expiry lifecycle (REV-003)", async function () {
  const { viem } = await network.create();

  const PRODUCT_HASH =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const RECEIPT_HASH =
    "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
  const EVIDENCE_HASH =
    "0x3333333333333333333333333333333333333333333333333333333333333333" as const;

  // DecisionResult enum: None = 0, Approve = 1, Reject = 2.
  const APPROVE = 1;
  const MODEL_VERSION =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

  const DECISION_TYPES = {
    ClaimDecision: [
      { name: "chainId", type: "uint256" },
      { name: "verifier", type: "address" },
      { name: "claimId", type: "uint256" },
      { name: "coverageId", type: "uint256" },
      { name: "claimant", type: "address" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "result", type: "uint8" },
      { name: "modelVersion", type: "bytes32" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
  } as const;

  async function setup() {
    const wallets = await viem.getWalletClients();
    const merchant = wallets[0];
    const claimant = wallets[1];
    const relayer = wallets[2];
    const other = wallets[3];
    const evaluator = wallets[9];
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
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

    const domain = {
      name: "Resvyn Warranty Reserve",
      version: "1",
      chainId: BigInt(chainId),
      verifyingContract: reserve.address,
    } as const;

    async function sign(decision: Record<string, unknown>) {
      return evaluator.signTypedData({
        account: evaluator.account,
        domain,
        types: DECISION_TYPES,
        primaryType: "ClaimDecision",
        message: decision as never,
      });
    }

    // Fund the merchant and issue coverage 1 to the claimant with a short,
    // caller-chosen expiry window relative to the current block time.
    return { wallets, merchant, claimant, relayer, other, evaluator, publicClient, testClient, chainId, reserve, reserveAsClaimant, reserveAsRelayer, domain, sign };
  }

  it("issues coverage only with a future expiry (existing rule, pinned)", async function () {
    const { reserve, merchant, claimant, publicClient } = await setup();
    await reserve.write.depositReserve([], { value: parseEther("5") });
    const now = (await publicClient.getBlock()).timestamp;

    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant.account.address,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("1"),
        now - 1n, // expired at issuance
      ]),
      reserve,
      "InvalidExpiry",
    );
  });

  // [BOUNDARY] openClaim uses `block.timestamp >= cov.expiry`, so the claim
  // window is inclusive of the coverage expiry second: opening exactly at the
  // expiry must revert, one second before must succeed.
  it("opens a claim in the final second before expiry and reverts at expiry", async function () {
    const { reserve, reserveAsClaimant, publicClient, testClient, claimant } = await setup();
    const now = (await publicClient.getBlock()).timestamp;
    const expiry = now + 10n;

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      expiry,
    ]);

    // One second before expiry: open succeeds.
    await testClient.setNextBlockTimestamp({ timestamp: expiry - 1n });
    await reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);
    assert.equal(await reserve.read.claimCount(), 1n);

    // A second coverage (same claimant) opened exactly at its own expiry:
    // reverts. Its window is far enough in the future to clear the already
    // advanced chain clock.
    const expiry2 = expiry + 100n;
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      expiry2,
    ]);
    await testClient.setNextBlockTimestamp({ timestamp: expiry2 });
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([2n, EVIDENCE_HASH]),
      reserve,
      "CoverageAlreadyExpired",
    );
  });

  it("reverts openClaim after expiry", async function () {
    const { reserve, reserveAsClaimant, publicClient, testClient, claimant } = await setup();
    const now = (await publicClient.getBlock()).timestamp;
    const expiry = now + 10n;

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      expiry,
    ]);

    await testClient.setNextBlockTimestamp({ timestamp: expiry + 1n });
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "CoverageAlreadyExpired",
    );
  });

  it("rejects expireCoverage before expiry", async function () {
    const { reserve, publicClient, claimant } = await setup();
    const now = (await publicClient.getBlock()).timestamp;
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      now + 100n,
    ]);

    await viem.assertions.revertWithCustomError(
      reserve.write.expireCoverage([1n]),
      reserve,
      "CoverageNotExpired",
    );
  });

  // [POSITIVE PROOF] REV-003: an unused, past-expiry coverage releases its
  // full lock exactly once, permissionlessly.
  it("expires an unused past-expiry coverage and releases the full lock once", async function () {
    const { reserve, merchant, other, publicClient, testClient, claimant } = await setup();
    const now = (await publicClient.getBlock()).timestamp;
    const expiry = now + 10n;

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      expiry,
    ]);

    // Before expiry the lock is held: balance 5, locked 1, free 4.
    assert.deepEqual(await reserve.read.reserveOf([merchant.account.address]), [
      parseEther("5"),
      parseEther("1"),
      parseEther("4"),
    ]);

    // Any address (here `other`) may expire once the window passed.
    const reserveAsOther = await viem.getContractAt(
      "WarrantyReserve",
      reserve.address,
      { client: { wallet: other } },
    );
    await testClient.setNextBlockTimestamp({ timestamp: expiry });
    await viem.assertions.emitWithArgs(
      reserveAsOther.write.expireCoverage([1n]),
      reserve,
      "CoverageExpired",
      [1n, getAddress(merchant.account.address), parseEther("1"), expiry],
    );

    const cov = await reserve.read.coverageOf([1n]);
    assert.equal(cov.status, 2); // Expired
    // Lock released: balance 5, locked 0, free 5 (all funds recoverable).
    assert.deepEqual(await reserve.read.reserveOf([merchant.account.address]), [
      parseEther("5"),
      0n,
      parseEther("5"),
    ]);

    // Terminal: a second expire reverts (status no longer Active).
    await viem.assertions.revertWithCustomError(
      reserveAsOther.write.expireCoverage([1n]),
      reserve,
      "CoverageNotActive",
    );

    // The merchant can now withdraw the full freed reserve.
    await viem.assertions.balancesHaveChanged(
      reserve.write.withdrawReserve([parseEther("5")]),
      [{ address: merchant.account.address, amount: parseEther("5") }],
    );
  });

  // [GRACE RULE] a claim opened while the coverage was active is NOT
  // expirable and remains settleable after expiry: the lock is released only
  // through settlement, so no open claim can strand funds or double-release.
  it("keeps an open claim settleable after expiry and blocks expireCoverage", async function () {
    const { reserve, merchant, reserveAsClaimant, reserveAsRelayer, publicClient, testClient, claimant, sign } = await setup();
    const now = (await publicClient.getBlock()).timestamp;
    const expiry = now + 10n;

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      expiry,
    ]);
    // Open while active (one second before expiry).
    await testClient.setNextBlockTimestamp({ timestamp: expiry - 1n });
    await reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);

    // expireCoverage on a coverage with an open claim: reverts.
    await testClient.setNextBlockTimestamp({ timestamp: expiry + 1n });
    await viem.assertions.revertWithCustomError(
      reserve.write.expireCoverage([1n]),
      reserve,
      "ClaimAlreadyExists",
    );

    // The open claim is still settleable after expiry (grace rule): a valid
    // evaluator decision pays and releases the lock.
    const d = {
      chainId: BigInt((await publicClient.getChainId())),
      verifier: reserve.address,
      claimId: 1n,
      coverageId: 1n,
      claimant: claimant.account.address,
      evidenceHash: EVIDENCE_HASH,
      amount: parseEther("1"),
      result: APPROVE,
      modelVersion: MODEL_VERSION,
      expiry: BigInt((await publicClient.getBlock()).timestamp) + 1000n,
      nonce: 1n,
    };
    const sig = await sign(d);
    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimant.account.address, amount: parseEther("1") }],
    );

    // balance 5 -> 4, locked 1 -> 0, free 4 -> 4.
    assert.deepEqual(await reserve.read.reserveOf([merchant.account.address]), [
      parseEther("4"),
      0n,
      parseEther("4"),
    ]);
  });

  it("reverts expireCoverage for a nonexistent coverage", async function () {
    const { reserve } = await setup();
    await viem.assertions.revertWithCustomError(
      reserve.write.expireCoverage([99n]),
      reserve,
      "CoverageNotActive",
    );
  });
});
