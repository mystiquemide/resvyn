import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther } from "viem";

// Milestone 1 invariant surface for Resvyn's WarrantyReserve.
//
// Winning invariant: "No funded reserve, no valid coverage."
// Reserve accounting equation: freeReserve = reserveBalance - lockedExposure.
//
// The free-reserve guards are implemented (CP-002), so these tests are GREEN:
// they prove the guards reject issuance and withdrawal that would violate the
// winning invariant, and that rejected calls leave accounting untouched. Each
// test asserts the accounting equation on its pre-state so the equation stays
// explicit and any regression surfaces as an unambiguous failure.

describe("WarrantyReserve M1 invariants", async function () {
  const { viem } = await network.create();

  const FUTURE_EXPIRY = 2_000_000_000n; // ~2033, safely ahead of block time
  const PRODUCT_HASH =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const RECEIPT_HASH =
    "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

  async function setup() {
    const walletClients = await viem.getWalletClients();
    const merchant = walletClients[0];
    const claimant = walletClients[1].account.address;
    // The evaluator signer is only a non-zero constructor input for M1
    // invariants; the claim suite verifies its use.
    const evaluator = walletClients[9].account.address;
    const reserve = await viem.deployContract("WarrantyReserve", [evaluator]);
    return { merchant, claimant, reserve };
  }

  // [INVARIANT] BR-001 / FR-003: coverage whose maxPayout exceeds free reserve
  // must be rejected. RED until the issuance guard exists.
  it("rejects underfunded issuance with InsufficientFreeReserve", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("1") });

    // Accounting equation on pre-state: free = balance - locked = 1 - 0 = 1.
    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("1"));
    assert.equal(locked, 0n);
    assert.equal(free, balance - locked);
    assert.equal(free, parseEther("1"));

    // maxPayout (2) > free reserve (1): the winning invariant requires a revert.
    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("2"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "InsufficientFreeReserve",
    );

    // A rejected issuance must create no coverage and change no exposure.
    assert.equal(await reserve.read.coverageCount(), 0n);
    const after = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(after, [balance, locked, free]);
  });

  // [INVARIANT] BR-003 / FR-005: withdrawal cannot reduce reserve below locked
  // exposure. RED until the withdrawal guard exists.
  it("rejects withdrawal above free reserve and leaves accounting unchanged", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);

    // Accounting equation on pre-state: free = balance - locked = 5 - 3 = 2.
    const before = await reserve.read.reserveOf([merchant.account.address]);
    assert.equal(before[0], parseEther("5"));
    assert.equal(before[1], parseEther("3"));
    assert.equal(before[2], before[0] - before[1]);
    assert.equal(before[2], parseEther("2"));

    // Withdrawing 4 > free reserve (2): BR-003 requires a revert.
    await viem.assertions.revertWithCustomError(
      reserve.write.withdrawReserve([parseEther("4")]),
      reserve,
      "WithdrawalExceedsFreeReserve",
    );

    // Accounting must be unchanged after a rejected withdrawal.
    const after = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(after, before);
  });

  // [INVARIANT] BR-001 / BR-002: with exposure already locked, a second issuance
  // is bounded by FREE reserve, not total balance. This is the partial-lock case
  // the single-issuance guard test cannot reach: a regression that compares
  // maxPayout against reserveBalance instead of free reserve would pass the
  // empty-lock test but must fail here. The exact (free, requested) args are
  // pinned so the guard cannot be quietly loosened.
  it("bounds a second issuance by free reserve, not total balance", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);

    // Pre-state: balance 5, locked 3, free 2. A 3-payout issuance fits within
    // balance (5) but not within free (2), so it must be rejected.
    const before = await reserve.read.reserveOf([merchant.account.address]);
    assert.equal(before[0], parseEther("5"));
    assert.equal(before[1], parseEther("3"));
    assert.equal(before[2], before[0] - before[1]);
    assert.equal(before[2], parseEther("2"));

    await viem.assertions.revertWithCustomErrorWithArgs(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("3"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "InsufficientFreeReserve",
      [parseEther("2"), parseEther("3")],
    );

    // The first coverage still stands; no second coverage, no exposure change.
    assert.equal(await reserve.read.coverageCount(), 1n);
    const after = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(after, before);
  });
});
