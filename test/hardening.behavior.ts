import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther } from "viem";

const ZERO_HASH = `0x${"00".repeat(32)}` as const;
const PRODUCT_HASH = `0x${"11".repeat(32)}` as const;
const RECEIPT_HASH = `0x${"22".repeat(32)}` as const;
const FUTURE_EXPIRY = 2_000_000_000n;

describe("WarrantyReserve hardening", async function () {
  const { viem } = await network.create();

  async function setup() {
    const wallets = await viem.getWalletClients();
    const merchant = wallets[0];
    const claimant = wallets[1].account.address;
    const evaluator = wallets[9].account.address;
    const reserve = await viem.deployContract("WarrantyReserve", [evaluator]);
    await reserve.write.depositReserve([], { value: parseEther("1") });
    return { merchant, claimant, reserve };
  }

  it("refuses coverage without a product commitment", async function () {
    const { claimant, reserve } = await setup();
    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant,
        ZERO_HASH,
        RECEIPT_HASH,
        parseEther("0.1"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "ZeroProductHash",
    );
    assert.equal(await reserve.read.coverageCount(), 0n);
  });

  it("refuses coverage without a receipt commitment", async function () {
    const { claimant, reserve } = await setup();
    await viem.assertions.revertWithCustomError(
      reserve.write.issueCoverage([
        claimant,
        PRODUCT_HASH,
        ZERO_HASH,
        parseEther("0.1"),
        FUTURE_EXPIRY,
      ]),
      reserve,
      "ZeroReceiptHash",
    );
    assert.equal(await reserve.read.coverageCount(), 0n);
  });

  it("refuses zero-value withdrawals without changing accounting", async function () {
    const { merchant, reserve } = await setup();
    const before = await reserve.read.reserveOf([merchant.account.address]);
    await viem.assertions.revertWithCustomError(
      reserve.write.withdrawReserve([0n]),
      reserve,
      "ZeroWithdrawal",
    );
    const after = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(after, before);
  });
});
