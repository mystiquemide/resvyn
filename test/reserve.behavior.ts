import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

// Milestone 1 behavior surface for Resvyn's WarrantyReserve.
//
// The invariant tests in reserve.invariants.ts prove the winning guards reject
// unsafe issuance and withdrawal. This file proves the happy-path accounting,
// events, input validation, exposure locking (BR-002), immutability (BR-004),
// multi-issuance accumulation, and free-reserve withdrawal (FR-005) behave
// exactly as the Milestone 1 contract requires.

describe("WarrantyReserve M1 behavior", async function () {
  const { viem } = await network.create();

  const FUTURE_EXPIRY = 2_000_000_000n; // ~2033, safely ahead of block time
  const PRODUCT_HASH =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const RECEIPT_HASH =
    "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

  // CoverageStatus enum: None = 0, Active = 1.
  const STATUS_ACTIVE = 1;

  async function setup() {
    const walletClients = await viem.getWalletClients();
    const merchant = walletClients[0];
    const claimant = walletClients[1].account.address;
    const publicClient = await viem.getPublicClient();
    const reserve = await viem.deployContract("WarrantyReserve");
    return { merchant, claimant, publicClient, reserve };
  }

  // [BEHAVIOR] FR-002: a deposit credits the caller's reserve exactly and emits
  // ReserveDeposited with the running balance.
  it("credits deposits exactly and emits ReserveDeposited", async function () {
    const { merchant, reserve } = await setup();

    await viem.assertions.emitWithArgs(
      reserve.write.depositReserve([], { value: parseEther("1.5") }),
      reserve,
      "ReserveDeposited",
      [getAddress(merchant.account.address), parseEther("1.5"), parseEther("1.5")],
    );

    // A second deposit accumulates and reports the new running balance.
    await viem.assertions.emitWithArgs(
      reserve.write.depositReserve([], { value: parseEther("0.5") }),
      reserve,
      "ReserveDeposited",
      [getAddress(merchant.account.address), parseEther("0.5"), parseEther("2")],
    );

    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("2"));
    assert.equal(locked, 0n);
    assert.equal(free, parseEther("2"));
  });

  // [BEHAVIOR] FR-002: a zero-value deposit is rejected with ZeroDeposit.
  it("rejects a zero-value deposit with ZeroDeposit", async function () {
    const { reserve } = await setup();

    await viem.assertions.revertWithCustomError(
      reserve.write.depositReserve([], { value: 0n }),
      reserve,
      "ZeroDeposit",
    );
  });

  // [BEHAVIOR] BR-002 / FR-003: a funded issuance locks exactly maxPayout,
  // returns a monotonic id, stores the full coverage record, and emits
  // CoverageIssued.
  it("issues funded coverage, locks exposure, and stores the record", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("10") });

    await viem.assertions.emitWithArgs(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("4"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "CoverageIssued",
      [
        1n,
        getAddress(merchant.account.address),
        getAddress(claimant),
        parseEther("4"),
        FUTURE_EXPIRY,
      ],
    );

    // Exposure is locked by exactly maxPayout; free shrinks by the same amount.
    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("10"));
    assert.equal(locked, parseEther("4"));
    assert.equal(free, parseEther("6"));

    // The stored record matches the issuance inputs and is Active.
    assert.equal(await reserve.read.coverageCount(), 1n);
    const coverage = await reserve.read.coverageOf([1n]);
    assert.equal(coverage.merchant, getAddress(merchant.account.address));
    assert.equal(coverage.claimant, getAddress(claimant));
    assert.equal(coverage.productHash, PRODUCT_HASH);
    assert.equal(coverage.receiptHash, RECEIPT_HASH);
    assert.equal(coverage.maxPayout, parseEther("4"));
    assert.equal(coverage.expiry, FUTURE_EXPIRY);
    assert.equal(coverage.status, STATUS_ACTIVE);
  });

  // [BEHAVIOR] FR-003: issuance validates its inputs before touching state.
  it("rejects issuance with an invalid claimant, zero payout, or past expiry", async function () {
    const { claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("5") });

    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        ZERO_ADDRESS,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("1"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "InvalidClaimant",
    );

    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        0n,
        FUTURE_EXPIRY,
      ]),
      reserve,
      "ZeroMaxPayout",
    );

    // Expiry at or before the current block timestamp is rejected.
    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("1"),
        1n,
      ]),
      reserve,
      "InvalidExpiry",
    );

    // No coverage was created and no exposure was locked by rejected calls.
    assert.equal(await reserve.read.coverageCount(), 0n);
  });

  // [BEHAVIOR] BR-002: multiple issuances accumulate exposure and ids.
  it("accumulates exposure and ids across multiple issuances", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("10") });

    const firstId = await reserve.simulate.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("2"),
      FUTURE_EXPIRY,
    ]);

    assert.equal(firstId.result, 1n);
    assert.equal(await reserve.read.coverageCount(), 2n);

    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("10"));
    assert.equal(locked, parseEther("5"));
    assert.equal(free, parseEther("5"));
  });

  // [BEHAVIOR] FR-005: a merchant may withdraw free reserve; the balance drops,
  // native token is transferred, and ReserveWithdrawn is emitted.
  it("allows withdrawal of free reserve and transfers native token", async function () {
    const { merchant, claimant, publicClient, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("8") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);

    // Free reserve is 8 - 3 = 5; withdraw 2 of it.
    const balanceBefore = await publicClient.getBalance({
      address: merchant.account.address,
    });

    const hash = await reserve.write.withdrawReserve([parseEther("2")]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;

    // The withdrawal emits ReserveWithdrawn with the running balance (8 - 2 = 6).
    await viem.assertions.emitWithArgs(
      hash,
      reserve,
      "ReserveWithdrawn",
      [getAddress(merchant.account.address), parseEther("2"), parseEther("6")],
    );

    // Accounting: balance falls by the withdrawal, locked is untouched.
    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("6"));
    assert.equal(locked, parseEther("3"));
    assert.equal(free, parseEther("3"));

    // Native token actually moved to the merchant, net of gas.
    const balanceAfter = await publicClient.getBalance({
      address: merchant.account.address,
    });
    assert.equal(balanceAfter, balanceBefore + parseEther("2") - gasCost);
  });

  // [BEHAVIOR] FR-005: withdrawing the entire free reserve down to locked is
  // allowed; withdrawing one wei more is rejected.
  it("permits withdrawing down to locked exposure but not below", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);

    // Draining exactly the free reserve (2) succeeds.
    await reserve.write.withdrawReserve([parseEther("2")]);

    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("3"));
    assert.equal(locked, parseEther("3"));
    assert.equal(free, 0n);

    // One wei more would cross into locked exposure and must revert.
    await viem.assertions.revertWithCustomError(
      reserve.write.withdrawReserve([1n]),
      reserve,
      "WithdrawalExceedsFreeReserve",
    );
  });

  // [BEHAVIOR] BR-001 boundary: issuance at exactly free reserve succeeds and
  // drives free to zero; one wei beyond it is rejected with the exact args.
  it("issues coverage at exactly free reserve but not one wei beyond", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("1") });

    // maxPayout == free (1 == 1) is allowed and locks the whole balance.
    await viem.assertions.emitWithArgs(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("1"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "CoverageIssued",
      [
        1n,
        getAddress(merchant.account.address),
        getAddress(claimant),
        parseEther("1"),
        FUTURE_EXPIRY,
      ],
    );

    const [balance, locked, free] = await reserve.read.reserveOf([
      merchant.account.address,
    ]);
    assert.equal(balance, parseEther("1"));
    assert.equal(locked, parseEther("1"));
    assert.equal(free, 0n);
    assert.equal(await reserve.read.coverageCount(), 1n);

    // With free at zero, a 1-wei payout is rejected: free = 0, requested = 1.
    await viem.assertions.revertWithCustomErrorWithArgs(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        1n,
        FUTURE_EXPIRY,
      ]),
      reserve,
      "InsufficientFreeReserve",
      [0n, 1n],
    );

    // The rejected call created no coverage and moved no exposure.
    assert.equal(await reserve.read.coverageCount(), 1n);
    const after = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(after, [balance, locked, free]);
  });

  // [BEHAVIOR] BR-001 isolation: reserves are per-merchant. A merchant with no
  // deposit cannot issue or withdraw, and one merchant's funding never leaks
  // into another's accounting. This is the purest statement of the winning
  // invariant: no funded reserve, no valid coverage.
  it("keeps reserves isolated per merchant", async function () {
    const walletClients = await viem.getWalletClients();
    const merchantA = walletClients[0];
    const merchantB = walletClients[1];
    const claimant = walletClients[2].account.address;
    const reserve = await viem.deployContract("WarrantyReserve");

    // A second contract handle bound to merchantB's wallet so its writes are
    // sent from merchantB, not the default account.
    const reserveAsB = await viem.getContractAt(
      "WarrantyReserve",
      reserve.address,
      { client: { wallet: merchantB } },
    );

    // merchantB has funded nothing: issuance must revert with free = 0.
    await viem.assertions.revertWithCustomErrorWithArgs(
      reserveAsB.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        RECEIPT_HASH,
        parseEther("1"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "InsufficientFreeReserve",
      [0n, parseEther("1")],
    );

    // merchantA funds and issues; this must not credit merchantB at all.
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("2"),
      FUTURE_EXPIRY,
    ]);

    const a = await reserve.read.reserveOf([merchantA.account.address]);
    assert.deepEqual(a, [parseEther("5"), parseEther("2"), parseEther("3")]);

    const b = await reserve.read.reserveOf([merchantB.account.address]);
    assert.deepEqual(b, [0n, 0n, 0n]);

    // merchantB still cannot withdraw against merchantA's funds: free = 0.
    await viem.assertions.revertWithCustomErrorWithArgs(
      reserveAsB.write.withdrawReserve([1n]),
      reserve,
      "WithdrawalExceedsFreeReserve",
      [0n, 1n],
    );

    // merchantA's accounting is unchanged by merchantB's failed attempts.
    const aAfter = await reserve.read.reserveOf([merchantA.account.address]);
    assert.deepEqual(aAfter, a);
  });

  // [BEHAVIOR] BR-004: maxPayout and the rest of a coverage record are immutable
  // after issuance. Later issuances and a withdrawal must not mutate an earlier
  // record. No setter exists; this proves the stored record stays put.
  it("keeps an issued coverage record immutable across later activity", async function () {
    const { merchant, claimant, reserve } = await setup();

    await reserve.write.depositReserve([], { value: parseEther("10") });
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("3"),
      FUTURE_EXPIRY,
    ]);

    const original = await reserve.read.coverageOf([1n]);

    // Churn the contract: another issuance and a free-reserve withdrawal.
    await reserve.write.issueCoverage([
      claimant,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("2"),
      FUTURE_EXPIRY,
    ]);
    await reserve.write.withdrawReserve([parseEther("1")]);

    // Coverage #1 is byte-for-byte the record written at issuance.
    const reread = await reserve.read.coverageOf([1n]);
    assert.equal(reread.merchant, original.merchant);
    assert.equal(reread.claimant, original.claimant);
    assert.equal(reread.productHash, original.productHash);
    assert.equal(reread.receiptHash, original.receiptHash);
    assert.equal(reread.maxPayout, parseEther("3"));
    assert.equal(reread.expiry, FUTURE_EXPIRY);
    assert.equal(reread.status, STATUS_ACTIVE);
  });

  // [BEHAVIOR] FR-005 failure path: if the payout transfer back to the merchant
  // fails, withdrawReserve reverts with WithdrawalTransferFailed and rolls back
  // the balance. A contract-merchant with a reverting receive() forces this.
  it("reverts and preserves balance when the withdrawal transfer fails", async function () {
    const { reserve } = await setup();

    const badMerchant = await viem.deployContract("RevertingMerchant", [
      reserve.address,
    ]);

    // Fund the contract-merchant's reserve through its forwarding deposit.
    await badMerchant.write.deposit([], { value: parseEther("4") });

    const before = await reserve.read.reserveOf([badMerchant.address]);
    assert.deepEqual(before, [parseEther("4"), 0n, parseEther("4")]);

    // The reserve's push transfer hits the reverting receive(): must revert.
    await viem.assertions.revertWithCustomError(
      badMerchant.write.withdraw([parseEther("1")]),
      reserve,
      "WithdrawalTransferFailed",
    );

    // The failed withdrawal left the reserve balance fully intact.
    const after = await reserve.read.reserveOf([badMerchant.address]);
    assert.deepEqual(after, before);
  });
});
