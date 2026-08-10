import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, keccak256, parseEther, toHex, zeroAddress } from "viem";

// Milestone 3 claim-lifecycle surface for Resvyn's WarrantyReserve.
//
// The claimant opens a claim bound to one coverage and one evidence hash
// (BR-005, BR-006, BR-013). The AI evaluator signs an EIP-712 decision
// (BR-007, BR-008); resolveClaim verifies the signer and every bound field,
// then either pays the claimant bounded native BOT from the locked reserve and
// releases the lock atomically (BR-009, BR-011), or rejects and releases the
// lock without payout. A finalized claim is terminal (BR-010, ADR-004,
// DEC-006). A failed payout reverts the whole call and changes nothing
// (BR-012). The evaluator signer is immutable, preserving the zero-admin
// property (ADR-007, ADR-008).

describe("WarrantyReserve M3 claim lifecycle", async function () {
  const { viem } = await network.create();

  const FUTURE_EXPIRY = 2_000_000_000n; // ~2033
  const PRODUCT_HASH =
    "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const RECEIPT_HASH =
    "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
  const EVIDENCE_HASH =
    "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
  const OTHER_HASH =
    "0x4444444444444444444444444444444444444444444444444444444444444444" as const;
  const MODEL_VERSION = keccak256(toHex("resvyn-eval-v1"));

  // DecisionResult enum: None = 0, Approve = 1, Reject = 2.
  const APPROVE = 1;
  const REJECT = 2;
  const NONE = 0;

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

    function baseDecision(overrides: Record<string, unknown> = {}) {
      return {
        chainId: BigInt(chainId),
        verifier: reserve.address,
        claimId: 1n,
        coverageId: 1n,
        claimant: claimant.account.address,
        evidenceHash: EVIDENCE_HASH,
        amount: parseEther("1"),
        result: APPROVE,
        modelVersion: MODEL_VERSION,
        expiry: FUTURE_EXPIRY,
        nonce: 1n,
        ...overrides,
      };
    }

    async function sign(
      decision: Record<string, unknown>,
      opts: { signer?: typeof evaluator; domainOverride?: Record<string, unknown> } = {},
    ) {
      const signer = opts.signer ?? evaluator;
      return signer.signTypedData({
        account: signer.account,
        domain: { ...domain, ...(opts.domainOverride ?? {}) },
        types: DECISION_TYPES,
        primaryType: "ClaimDecision",
        message: decision as never,
      });
    }

    return {
      wallets,
      merchant,
      claimant,
      relayer,
      other,
      evaluator,
      publicClient,
      chainId,
      reserve,
      reserveAsClaimant,
      reserveAsRelayer,
      domain,
      baseDecision,
      sign,
    };
  }

  // Fund the merchant, issue coverage 1 to the EOA claimant, and open claim 1.
  // Merchant holds 5, locks 1, so free = 4 after issuance.
  async function seeded() {
    const ctx = await setup();
    await ctx.reserve.write.depositReserve([], { value: parseEther("5") });
    await ctx.reserve.write.issueCoverage([
      ctx.claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await ctx.reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);
    return ctx;
  }

  // ---- Happy path ----------------------------------------------------------

  // [BEHAVIOR] FR-006: the claimant opens a claim bound to coverage and
  // evidence hash; ClaimOpened is emitted and the claim is recorded Open.
  it("opens a claim bound to coverage and evidence hash", async function () {
    const { reserve, reserveAsClaimant, claimant } = await setup();
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);

    await viem.assertions.emitWithArgs(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "ClaimOpened",
      [1n, 1n, getAddress(claimant.account.address), EVIDENCE_HASH],
    );

    assert.equal(await reserve.read.claimCount(), 1n);
    assert.equal(await reserve.read.claimIdOfCoverage([1n]), 1n);
    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.coverageId, 1n);
    assert.equal(getAddress(claim.claimant), getAddress(claimant.account.address));
    assert.equal(claim.evidenceHash, EVIDENCE_HASH);
    assert.equal(claim.paidAmount, 0n);
    assert.equal(claim.status, 1); // Open
  });

  // [BEHAVIOR] FR-006: openedAt snapshots the mining block's timestamp. The
  // field is written at open and never asserted elsewhere; this pins it to the
  // actual block time so a regression that dropped or mis-set it would surface.
  it("records openedAt as the mining block timestamp", async function () {
    const { reserve, reserveAsClaimant, publicClient, claimant } = await setup();
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);

    const hash = await reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });

    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.openedAt, block.timestamp);
  });

  // [POSITIVE PROOF] FR-012 / BR-009 / BR-011: a valid approved decision pays
  // the claimant the full maxPayout, reduces reserve balance and locked
  // exposure atomically, and emits ClaimPaid.
  it("pays the claimant on a full-amount approval and releases the lock", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await seeded();

    const d = baseDecision({ amount: parseEther("1") });
    const sig = await sign(d);

    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimant.account.address, amount: parseEther("1") }],
    );

    // Approve full: balance 5 -> 4, locked 1 -> 0, free 4 -> 4.
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    const acct = await reserve.read.reserveOf([merchantAcct]);
    assert.deepEqual(acct, [parseEther("4"), 0n, parseEther("4")]);

    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 2); // Approved
    assert.equal(claim.paidAmount, parseEther("1"));
    assert.equal(await reserve.read.isNonceUsed([1n]), true);
  });

  // [POSITIVE PROOF] BR-009 partial: an approval below maxPayout pays only the
  // approved amount but releases the FULL lock, so the remainder returns to
  // the merchant's free reserve.
  it("on a partial approval pays the amount but frees the full lock", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await seeded();

    const d = baseDecision({ amount: parseEther("0.3") });
    const sig = await sign(d);

    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimant.account.address, amount: parseEther("0.3") }],
    );

    // balance 5 -> 4.7, locked 1 -> 0, free 4 -> 4.7 (full 1 released).
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    const acct = await reserve.read.reserveOf([merchantAcct]);
    assert.deepEqual(acct, [parseEther("4.7"), 0n, parseEther("4.7")]);
    assert.equal((await reserve.read.claimOf([1n])).paidAmount, parseEther("0.3"));
  });

  // [BEHAVIOR] a rejection pays nothing, releases the full lock, finalizes the
  // claim Rejected, and emits ClaimRejected.
  it("rejects a claim without payout and releases the lock", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await seeded();

    const d = baseDecision({ result: REJECT, amount: 0n });
    const sig = await sign(d);

    await viem.assertions.emitWithArgs(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "ClaimRejected",
      [1n, 1n, getAddress(claimant.account.address), MODEL_VERSION, 1n],
    );

    // balance unchanged at 5, locked 1 -> 0, free 4 -> 5.
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    const acct = await reserve.read.reserveOf([merchantAcct]);
    assert.deepEqual(acct, [parseEther("5"), 0n, parseEther("5")]);
    assert.equal((await reserve.read.claimOf([1n])).status, 3); // Rejected
    assert.equal(await reserve.read.isNonceUsed([1n]), true);
  });

  // [BEHAVIOR] ClaimPaid carries the model version and nonce in its data.
  it("emits ClaimPaid with model version and nonce", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await seeded();
    const d = baseDecision({ amount: parseEther("1"), nonce: 77n });
    const sig = await sign(d);
    await viem.assertions.emitWithArgs(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "ClaimPaid",
      [1n, 1n, getAddress(claimant.account.address), parseEther("1"), MODEL_VERSION, 77n],
    );
  });

  // ---- EIP-712 field-mutation matrix (BR-008) ------------------------------

  // Each mutates ONE bound field. When the mutated field is a checked struct
  // field, the mapped revert fires. When the mutation is not re-signed, the
  // signature no longer recovers the evaluator, so InvalidSigner fires.

  it("rejects a decision for the wrong chainId (checked field)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ chainId: 999999n });
    const sig = await sign(d); // signed over the wrong chainId
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "WrongChain",
    );
  });

  it("rejects a decision signed under a different domain chainId (InvalidSigner)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision();
    const sig = await sign(d, { domainOverride: { chainId: 999999n } });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "InvalidSigner",
    );
  });

  it("rejects a decision for the wrong verifier (checked field)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ verifier: zeroAddress });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "WrongVerifier",
    );
  });

  it("rejects a decision signed for a different verifyingContract (InvalidSigner)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision();
    const sig = await sign(d, { domainOverride: { verifyingContract: zeroAddress } });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "InvalidSigner",
    );
  });

  it("rejects a decision whose coverageId does not match the claim", async function () {
    // Seed a second coverage so coverageId 2 exists but is bound to claim 2.
    const ctx = await seeded();
    await ctx.reserve.write.issueCoverage([
      ctx.claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    const d = ctx.baseDecision({ claimId: 1n, coverageId: 2n });
    const sig = await ctx.sign(d);
    await viem.assertions.revertWithCustomError(
      ctx.reserveAsRelayer.write.resolveClaim([d, sig]),
      ctx.reserve,
      "CoverageMismatch",
    );
  });

  it("rejects a decision whose claimant does not match the claim", async function () {
    const { reserve, reserveAsRelayer, other, baseDecision, sign } = await seeded();
    const d = baseDecision({ claimant: other.account.address });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "ClaimantMismatch",
    );
  });

  it("rejects a decision whose evidence hash does not match the claim", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ evidenceHash: OTHER_HASH });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "EvidenceMismatch",
    );
  });

  it("rejects an approval above the coverage maximum payout (BR-009)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ amount: parseEther("2") });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "AmountOutOfRange",
    );
  });

  it("rejects an approval of zero amount (BR-009)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ amount: 0n });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "AmountOutOfRange",
    );
  });

  it("rejects a reject-result decision carrying a nonzero amount", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ result: REJECT, amount: parseEther("1") });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "AmountOutOfRange",
    );
  });

  it("rejects a None result with InvalidResult", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ result: NONE, amount: 0n });
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "InvalidResult",
    );
  });

  it("reverts on an out-of-range result enum value", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ result: 3, amount: 0n });
    const sig = await sign(d);
    // Solidity 0.8 enum conversion of an out-of-range value panics (0x21).
    await viem.assertions.revert(reserveAsRelayer.write.resolveClaim([d, sig]));
  });

  it("rejects a decision with a mutated but unsigned model version (InvalidSigner)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision();
    const sig = await sign(d);
    const tampered = { ...d, modelVersion: keccak256(toHex("tampered")) };
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([tampered, sig]),
      reserve,
      "InvalidSigner",
    );
  });

  it("rejects an expired decision", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ expiry: 1n }); // far in the past
    const sig = await sign(d);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "DecisionExpired",
    );
  });

  it("rejects a decision with a mutated but unsigned nonce (InvalidSigner)", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision();
    const sig = await sign(d);
    const tampered = { ...d, nonce: 999n };
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([tampered, sig]),
      reserve,
      "InvalidSigner",
    );
  });

  // ---- Signature authenticity ---------------------------------------------

  it("rejects a decision signed by a non-evaluator key", async function () {
    const { reserve, reserveAsRelayer, other, baseDecision, sign } = await seeded();
    const d = baseDecision();
    const sig = await sign(d, { signer: other });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "InvalidSigner",
    );
  });

  it("reverts on a malformed signature", async function () {
    const { reserve, reserveAsRelayer, baseDecision } = await seeded();
    const d = baseDecision();
    const badSig = `0x${"00".repeat(65)}` as const;
    // An all-zero 65-byte signature recovers no key; OZ ECDSA rejects it.
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, badSig]),
      reserve,
      "ECDSAInvalidSignature",
    );
  });

  // ---- Replay / finalization (BR-010) --------------------------------------

  it("blocks replay of the exact same approved decision by nonce", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ amount: parseEther("1") });
    const sig = await sign(d);
    await reserveAsRelayer.write.resolveClaim([d, sig]);
    // Same nonce again: the nonce guard (step 8) fires before status.
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "NonceAlreadyUsed",
    );
  });

  it("blocks re-finalizing an approved claim with a fresh nonce", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const first = baseDecision({ amount: parseEther("1"), nonce: 1n });
    await reserveAsRelayer.write.resolveClaim([first, await sign(first)]);
    // A brand-new decision on the same, now-Approved claim.
    const second = baseDecision({ amount: parseEther("1"), nonce: 2n });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([second, await sign(second)]),
      reserve,
      "ClaimAlreadyFinalized",
    );
  });

  it("blocks re-finalizing a rejected claim with a fresh nonce", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const first = baseDecision({ result: REJECT, amount: 0n, nonce: 1n });
    await reserveAsRelayer.write.resolveClaim([first, await sign(first)]);
    const second = baseDecision({ amount: parseEther("1"), nonce: 2n });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([second, await sign(second)]),
      reserve,
      "ClaimAlreadyFinalized",
    );
  });

  it("blocks reuse of a nonce across two different claims", async function () {
    const ctx = await seeded();
    // Second coverage + claim for the same claimant.
    await ctx.reserve.write.issueCoverage([
      ctx.claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await ctx.reserveAsClaimant.write.openClaim([2n, EVIDENCE_HASH]);

    const first = ctx.baseDecision({ claimId: 1n, coverageId: 1n, nonce: 5n });
    await ctx.reserveAsRelayer.write.resolveClaim([first, await ctx.sign(first)]);

    const second = ctx.baseDecision({ claimId: 2n, coverageId: 2n, nonce: 5n });
    await viem.assertions.revertWithCustomError(
      ctx.reserveAsRelayer.write.resolveClaim([second, await ctx.sign(second)]),
      ctx.reserve,
      "NonceAlreadyUsed",
    );
  });

  // [NEGATIVE PROOF] DEC-006: reject is terminal. No approval can follow it.
  it("keeps a rejected claim terminal against a later approval", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const rej = baseDecision({ result: REJECT, amount: 0n, nonce: 1n });
    await reserveAsRelayer.write.resolveClaim([rej, await sign(rej)]);
    const app = baseDecision({ amount: parseEther("1"), nonce: 2n });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([app, await sign(app)]),
      reserve,
      "ClaimAlreadyFinalized",
    );
  });

  // ---- Authorization / state machine ---------------------------------------

  it("rejects openClaim from a non-claimant", async function () {
    const { reserve, reserveAsRelayer, claimant } = await setup();
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    // relayer is not the bound claimant.
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "NotClaimant",
    );
  });

  it("rejects a second openClaim on the same coverage", async function () {
    const { reserve, reserveAsClaimant } = await seeded();
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "ClaimAlreadyExists",
    );
  });

  // [NEGATIVE PROOF] ADR-004: one terminal claim per coverage, forever. The
  // openClaim guard is the persistent `_claimOfCoverage` mapping, which
  // resolveClaim never clears. These two tests pin that a coverage stays
  // unclaimable AFTER its claim finalizes, not just while it is Open. They
  // kill a "free the mapping on resolve" refactor that would otherwise let a
  // resolved coverage be re-claimed and break the winning invariant.
  it("keeps a coverage unclaimable after its claim is approved", async function () {
    const { reserve, reserveAsClaimant, reserveAsRelayer, baseDecision, sign } =
      await seeded();
    const d = baseDecision({ amount: parseEther("1") });
    await reserveAsRelayer.write.resolveClaim([d, await sign(d)]);

    // The binding persists through finalization.
    assert.equal(await reserve.read.claimIdOfCoverage([1n]), 1n);
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "ClaimAlreadyExists",
    );
  });

  it("keeps a coverage unclaimable after its claim is rejected", async function () {
    const { reserve, reserveAsClaimant, reserveAsRelayer, baseDecision, sign } =
      await seeded();
    const d = baseDecision({ result: REJECT, amount: 0n });
    await reserveAsRelayer.write.resolveClaim([d, await sign(d)]);

    assert.equal(await reserve.read.claimIdOfCoverage([1n]), 1n);
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "ClaimAlreadyExists",
    );
  });

  it("rejects openClaim on a nonexistent coverage", async function () {
    const { reserve, reserveAsClaimant } = await setup();
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]),
      reserve,
      "CoverageNotActive",
    );
  });

  it("rejects openClaim with a zero evidence hash", async function () {
    const { reserve, reserveAsClaimant, claimant } = await setup();
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await viem.assertions.revertWithCustomError(
      reserveAsClaimant.write.openClaim([
        1n,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ]),
      reserve,
      "ZeroEvidenceHash",
    );
  });

  it("rejects resolveClaim on a claim that was never opened", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await setup();
    // Issue coverage but never open a claim.
    await reserve.write.depositReserve([], { value: parseEther("5") });
    await reserve.write.issueCoverage([
      claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    const d = baseDecision();
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, await sign(d)]),
      reserve,
      "ClaimNotOpen",
    );
  });

  it("rejects deployment with a zero evaluator signer", async function () {
    // A valid instance supplies the error ABI for the custom-error matcher.
    const { reserve } = await setup();
    await viem.assertions.revertWithCustomError(
      viem.deployContract("WarrantyReserve", [zeroAddress]),
      reserve,
      "ZeroEvaluatorSigner",
    );
  });

  // ---- Accounting reconciliation ------------------------------------------

  it("does not change accounting when a claim is opened", async function () {
    const ctx = await setup();
    await ctx.reserve.write.depositReserve([], { value: parseEther("5") });
    await ctx.reserve.write.issueCoverage([
      ctx.claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    const before = await ctx.reserve.read.reserveOf([ctx.merchant.account.address]);
    await ctx.reserveAsClaimant.write.openClaim([1n, EVIDENCE_HASH]);
    const after = await ctx.reserve.read.reserveOf([ctx.merchant.account.address]);
    assert.deepEqual(after, before);
    assert.deepEqual(after, [parseEther("5"), parseEther("1"), parseEther("4")]);
  });

  it("lets the merchant withdraw the remainder freed by a partial approval", async function () {
    const { reserve, reserveAsRelayer, merchant, baseDecision, sign } =
      await seeded();
    const d = baseDecision({ amount: parseEther("0.3") });
    await reserveAsRelayer.write.resolveClaim([d, await sign(d)]);

    // Freed: balance 4.7, locked 0, free 4.7. Withdraw exactly 4.7 succeeds.
    await reserve.write.withdrawReserve([parseEther("4.7")]);
    const acct = await reserve.read.reserveOf([merchant.account.address]);
    assert.deepEqual(acct, [0n, 0n, 0n]);
  });

  it("blocks withdrawing one wei more than the freed remainder", async function () {
    const { reserve, reserveAsRelayer, baseDecision, sign } = await seeded();
    const d = baseDecision({ amount: parseEther("0.3") });
    await reserveAsRelayer.write.resolveClaim([d, await sign(d)]);
    await viem.assertions.revertWithCustomError(
      reserve.write.withdrawReserve([parseEther("4.7") + 1n]),
      reserve,
      "WithdrawalExceedsFreeReserve",
    );
  });

  it("isolates a second coverage's lock when the first claim resolves", async function () {
    const ctx = await seeded();
    // Second coverage locks another 1; merchant now locked 2 of 5.
    await ctx.reserve.write.issueCoverage([
      ctx.claimant.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    const before = await ctx.reserve.read.reserveOf([ctx.merchant.account.address]);
    assert.deepEqual(before, [parseEther("5"), parseEther("2"), parseEther("3")]);

    // Resolve claim 1 (approve full 1). Only coverage 1's lock releases.
    const d = ctx.baseDecision({ amount: parseEther("1") });
    await ctx.reserveAsRelayer.write.resolveClaim([d, await ctx.sign(d)]);

    // balance 5 -> 4, locked 2 -> 1 (coverage 2 still locked), free 3 -> 3.
    const after = await ctx.reserve.read.reserveOf([ctx.merchant.account.address]);
    assert.deepEqual(after, [parseEther("4"), parseEther("1"), parseEther("3")]);
  });

  // ---- Reentrancy / failed payout (BR-011, BR-012) -------------------------

  // A well-behaved contract claimant that simply accepts the transfer is paid.
  async function seededContractClaimant(mode: number) {
    const ctx = await setup();
    const claimantC = await viem.deployContract("ReentrantClaimant", [
      ctx.reserve.address,
    ]);
    await claimantC.write.setMode([mode]);
    await ctx.reserve.write.depositReserve([], { value: parseEther("5") });
    await ctx.reserve.write.issueCoverage([
      claimantC.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await claimantC.write.openClaim([1n, EVIDENCE_HASH]);
    // Decision bound to the contract claimant.
    const d = ctx.baseDecision({ claimant: claimantC.address, amount: parseEther("1") });
    const sig = await ctx.sign(d);
    return { ...ctx, claimantC, d, sig };
  }

  it("pays a well-behaved contract claimant (mode 0)", async function () {
    const { reserve, reserveAsRelayer, claimantC, d, sig } =
      await seededContractClaimant(0);
    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimantC.address, amount: parseEther("1") }],
    );
    assert.equal((await reserve.read.claimOf([1n])).status, 2); // Approved
  });

  it("blocks a claimant that re-enters resolveClaim during payout (mode 1)", async function () {
    const { reserve, reserveAsRelayer, claimantC, d, sig } =
      await seededContractClaimant(1);
    await claimantC.write.arm([d, sig]);
    // The re-entrant call is stopped (guard + CEI); the payout call returns
    // false, so the whole resolve reverts and nothing changes. The mock's
    // `reentered` flag is deliberately NOT asserted here: mode 1 lets the
    // guard's revert bubble up, which rolls the whole tx back, so any state
    // the mock wrote is erased. Mode 5 below swallows the revert to prove the
    // guard fired from committed state instead.
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "PayoutTransferFailed",
    );
    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 1); // still Open
    assert.equal(await reserve.read.isNonceUsed([1n]), false);
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    assert.deepEqual(await reserve.read.reserveOf([merchantAcct]), [
      parseEther("5"),
      parseEther("1"),
      parseEther("4"),
    ]);
  });

  // [POSITIVE PROOF] BR-011: the ReentrancyGuard actually fires on a re-entrant
  // resolveClaim. Mode 5 re-enters exactly like mode 1 but catches the guard's
  // revert so the outer payout commits. Because the tx succeeds, the mock's
  // `reentryBlocked` flag persists as direct evidence the inner call was
  // rejected, and the claim still finalizes Approved with the payout delivered.
  it("proves the reentrancy guard fires while the payout still commits (mode 5)", async function () {
    const { reserve, reserveAsRelayer, claimantC, d, sig } =
      await seededContractClaimant(5);
    await claimantC.write.arm([d, sig]);

    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimantC.address, amount: parseEther("1") }],
    );

    // The inner re-entry was attempted and blocked (committed proof).
    assert.equal(await claimantC.read.reentered(), true);
    assert.equal(await claimantC.read.reentryBlocked(), true);

    // The outer resolve committed normally despite the blocked re-entry.
    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 2); // Approved
    assert.equal(claim.paidAmount, parseEther("1"));
    assert.equal(await reserve.read.isNonceUsed([1n]), true);
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    assert.deepEqual(await reserve.read.reserveOf([merchantAcct]), [
      parseEther("4"),
      0n,
      parseEther("4"),
    ]);
  });

  it("blocks a claimant that re-enters withdrawReserve during payout (mode 2)", async function () {
    const { reserve, reserveAsRelayer, d, sig } =
      await seededContractClaimant(2);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "PayoutTransferFailed",
    );
    // Nothing moved; claim still Open.
    assert.equal((await reserve.read.claimOf([1n])).status, 1);
  });

  // [NEGATIVE PROOF] BR-012: a failed payout reverts the whole call and leaves
  // the claim unfinalized, the nonce unused, and accounting unchanged.
  it("reverts and changes nothing when the payout transfer fails (mode 3)", async function () {
    const { reserve, reserveAsRelayer, d, sig } =
      await seededContractClaimant(3);
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "PayoutTransferFailed",
    );
    const claim = await reserve.read.claimOf([1n]);
    assert.equal(claim.status, 1); // Open
    assert.equal(claim.paidAmount, 0n);
    assert.equal(await reserve.read.isNonceUsed([1n]), false);
    const merchantAcct = (await reserve.read.coverageOf([1n])).merchant;
    assert.deepEqual(await reserve.read.reserveOf([merchantAcct]), [
      parseEther("5"),
      parseEther("1"),
      parseEther("4"),
    ]);
  });

  it("lets a claim resolve normally after an earlier failed payout", async function () {
    const ctx = await seededContractClaimant(3);
    // First attempt fails (mode 3 reverts in receive()).
    await viem.assertions.revertWithCustomError(
      ctx.reserveAsRelayer.write.resolveClaim([ctx.d, ctx.sig]),
      ctx.reserve,
      "PayoutTransferFailed",
    );
    // Claimant becomes well-behaved; the same claim now pays with a fresh nonce.
    await ctx.claimantC.write.setMode([0]);
    const d2 = ctx.baseDecision({
      claimant: ctx.claimantC.address,
      amount: parseEther("1"),
      nonce: 2n,
    });
    await viem.assertions.balancesHaveChanged(
      ctx.reserveAsRelayer.write.resolveClaim([d2, await ctx.sign(d2)]),
      [{ address: ctx.claimantC.address, amount: parseEther("1") }],
    );
    assert.equal((await ctx.reserve.read.claimOf([1n])).status, 2); // Approved
  });

  // [NEGATIVE PROOF] BR-011 cross-merchant isolation under re-entrancy. The
  // claimant is itself a funded, partially-locked merchant. When it receives
  // its payout it re-enters withdrawReserve to pull its OWN free reserve. That
  // inner withdraw is scoped to msg.sender (the claimant) and CEI-safe, so it
  // can never reach the PAYING merchant's balance or locked funds. This is the
  // proof mode 2 could not give: mode 2's attacker held no reserve, so its
  // re-entrant withdraw always reverted and collapsed to the mode-3 failure
  // path. Here the re-entrant withdraw genuinely succeeds against the
  // attacker's own ledger, and the paying merchant still loses exactly the
  // payout, nothing more.
  it("scopes a re-entrant withdraw to the claimant, never the paying merchant (mode 4)", async function () {
    const ctx = await setup();
    const claimantC = await viem.deployContract("ReentrantClaimant", [
      ctx.reserve.address,
    ]);
    await claimantC.write.setMode([4]);

    // The claimant funds its OWN reserve and locks part of it: balance 3,
    // locked 2, free 1. Arm the re-entrant withdraw to that exact free reserve.
    await claimantC.write.depositReserve([], { value: parseEther("3") });
    await claimantC.write.issueCoverage([
      ctx.other.account.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("2"),
      FUTURE_EXPIRY,
    ]);
    await claimantC.write.setReentrantWithdrawTarget([parseEther("1")]);

    const ownBefore = await ctx.reserve.read.reserveOf([claimantC.address]);
    assert.deepEqual(ownBefore, [parseEther("3"), parseEther("2"), parseEther("1")]);

    // A SEPARATE merchant (the default account) funds and issues coverage to
    // the claimant, who opens the claim: balance 5, locked 1, free 4.
    await ctx.reserve.write.depositReserve([], { value: parseEther("5") });
    await ctx.reserve.write.issueCoverage([
      claimantC.address,
      PRODUCT_HASH,
      RECEIPT_HASH,
      parseEther("1"),
      FUTURE_EXPIRY,
    ]);
    await claimantC.write.openClaim([2n, EVIDENCE_HASH]);

    const payerBefore = await ctx.reserve.read.reserveOf([
      ctx.merchant.account.address,
    ]);
    assert.deepEqual(payerBefore, [parseEther("5"), parseEther("1"), parseEther("4")]);

    // Approve the full payout to the contract claimant. During the payout the
    // claimant re-enters withdrawReserve(1) against its OWN ledger.
    const d = ctx.baseDecision({
      claimId: 1n,
      coverageId: 2n,
      claimant: claimantC.address,
      amount: parseEther("1"),
    });
    await ctx.reserveAsRelayer.write.resolveClaim([d, await ctx.sign(d)]);

    // The re-entry actually happened and withdrew exactly the claimant's free.
    assert.equal(await claimantC.read.reentered(), true);
    assert.equal(await claimantC.read.reentrantWithdrawn(), parseEther("1"));

    // Paying merchant: lost ONLY the payout (5 -> 4), its lock released
    // (1 -> 0). The re-entrancy never reached its balance or locked funds.
    const payerAfter = await ctx.reserve.read.reserveOf([
      ctx.merchant.account.address,
    ]);
    assert.deepEqual(payerAfter, [parseEther("4"), 0n, parseEther("4")]);

    // Claimant's OWN reserve: withdrew exactly its free (balance 3 -> 2); its
    // locked 2 is intact and was never reachable from the payout path.
    const ownAfter = await ctx.reserve.read.reserveOf([claimantC.address]);
    assert.deepEqual(ownAfter, [parseEther("2"), parseEther("2"), 0n]);

    // The claim finalized Approved end to end.
    assert.equal((await ctx.reserve.read.claimOf([1n])).status, 2);
  });

  it("accepts an approval of exactly the maximum payout", async function () {
    const { reserve, reserveAsRelayer, claimant, baseDecision, sign } =
      await seeded();
    const d = baseDecision({ amount: parseEther("1") }); // == maxPayout
    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, await sign(d)]),
      [{ address: claimant.account.address, amount: parseEther("1") }],
    );
  });

  // [BOUNDARY] BR-008 decision expiry is inclusive: the check is
  // `d.expiry < block.timestamp`, so a decision whose expiry equals the
  // execution block timestamp is still fresh. setNextBlockTimestamp pins the
  // resolve block to exactly the expiry, proving the boundary second is
  // honored rather than off by one.
  it("accepts a decision whose expiry equals the block timestamp", async function () {
    const { reserve, reserveAsRelayer, claimant, publicClient, baseDecision, sign } =
      await seeded();
    const testClient = await viem.getTestClient();

    const latest = await publicClient.getBlock();
    const t = latest.timestamp + 100n;
    const d = baseDecision({ amount: parseEther("1"), expiry: t });
    const sig = await sign(d);

    // The next block (the resolve) mines at exactly t, so d.expiry == t and
    // `t < t` is false: the decision is accepted at its final valid second.
    await testClient.setNextBlockTimestamp({ timestamp: t });
    await viem.assertions.balancesHaveChanged(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      [{ address: claimant.account.address, amount: parseEther("1") }],
    );
    assert.equal((await reserve.read.claimOf([1n])).status, 2); // Approved
  });

  // [BOUNDARY] the second below the inclusive edge: expiry one less than the
  // execution block timestamp is stale and must revert DecisionExpired.
  it("rejects a decision whose expiry is one second before the block timestamp", async function () {
    const { reserve, reserveAsRelayer, publicClient, baseDecision, sign } =
      await seeded();
    const testClient = await viem.getTestClient();

    const latest = await publicClient.getBlock();
    const t = latest.timestamp + 100n;
    const d = baseDecision({ amount: parseEther("1"), expiry: t - 1n });
    const sig = await sign(d);

    // The resolve mines at t while d.expiry == t - 1, so `t - 1 < t` is true.
    await testClient.setNextBlockTimestamp({ timestamp: t });
    await viem.assertions.revertWithCustomError(
      reserveAsRelayer.write.resolveClaim([d, sig]),
      reserve,
      "DecisionExpired",
    );
  });
});
