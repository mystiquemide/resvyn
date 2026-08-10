import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  keccak256,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { evaluateAndSign, type DecisionBinding } from "./evaluator/service.js";
import type { ClaimEvidence } from "./evaluator/policy.js";

// Resvyn dress rehearsal: run the full fund -> issue -> claim -> payout flow
// against a live chain and assert the winning invariant on-chain
// ("no funded reserve, no valid coverage"; a payout releases the lock).
//
// This is a REHEARSAL tool. Its default and intended target is BOT Chain
// Testnet (chain 968, valueless tBOT). It deploys a fresh contract and sends
// real transactions, so every key is supplied by the operator at run time via
// env vars and NEVER stored in the repo. Running it against Mainnet (chain
// 677) is refused unless RESVYN_ALLOW_MAINNET=i-understand is set, because the
// Mainnet proof is a deliberate deploy-once ceremony, not a rehearsal.
//
// Keys / roles (all read from env at run time):
//   RESVYN_DEPLOYER_KEY   (required, funded) deploys, and acts as merchant and
//                          relayer: it deposits reserve, issues coverage, and
//                          submits resolveClaim.
//   RESVYN_CLAIMANT_KEY   (optional) opens the claim and receives the payout.
//                          If omitted, an ephemeral claimant is generated and
//                          funded from the deployer (RESVYN_CLAIMANT_FUNDING,
//                          default 0.02) so one funded deployer key runs the
//                          whole flow. A supplied key is never auto-topped-up.
//   RESVYN_EVALUATOR_KEY  (optional, UNFUNDED) its address becomes the
//                          immutable evaluatorSigner and it signs the EIP-712
//                          decision off-chain. If omitted, an ephemeral key is
//                          generated for the run (fine for a rehearsal).
//
// RPC:
//   RESVYN_RPC_URL        (required) e.g. https://rpc.bohr.life for Testnet.
//
// Amounts (tiny defaults; override in whole-BOT units if needed):
//   RESVYN_DEPOSIT        default 0.005
//   RESVYN_MAX_PAYOUT     default 0.001   (locked by the coverage)
//   RESVYN_APPROVE_AMOUNT default 0.001   (paid on approval; <= max payout)
//
// Cleanup:
//   RESVYN_RECLAIM        default off. Set to "1" to withdraw the merchant's
//                          free reserve (deposit - payout) back after the flow.
//                          Leave off for Testnet (valueless tBOT); set on for
//                          the Mainnet proof so no real BOT is stranded.
//
// Usage (Testnet):
//   RESVYN_RPC_URL=https://rpc.bohr.life \
//   RESVYN_DEPLOYER_KEY=0x... RESVYN_CLAIMANT_KEY=0x... \
//   npx hardhat run scripts/rehearse.ts
//
// Local validation (against `npx hardhat node --chain-id 968`):
//   see the runbook printed by this file's companion checkpoint.

const EXPECTED_TESTNET_CHAIN_ID = 968;
const MAINNET_CHAIN_ID = 677;

// EIP-712 domain, type, model version, and the decision result enum all live in
// the evaluator service now (scripts/evaluator/service.ts), so the rehearsal and
// the contract share one source of truth. APPROVE is kept here only to assert
// the fixture drove an approval.
const APPROVE = 1;

// Fixed test hashes for the rehearsal record (never raw evidence on-chain).
const PRODUCT_HASH = keccak256(toHex("resvyn-rehearsal-product"));
const RECEIPT_HASH = keccak256(toHex("resvyn-rehearsal-receipt"));
const EVIDENCE_HASH = keccak256(toHex("resvyn-rehearsal-evidence"));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`Missing required env var ${name}. See the header of scripts/rehearse.ts.`);
  }
  return v.trim();
}

function parseAmount(name: string, fallback: string): bigint {
  return parseEther(process.env[name]?.trim() ?? fallback);
}

async function loadArtifact() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(
    here,
    "..",
    "artifacts",
    "contracts",
    "WarrantyReserve.sol",
    "WarrantyReserve.json",
  );
  const raw = await readFile(path, "utf8");
  const json = JSON.parse(raw);
  if (!json.abi || !json.bytecode) {
    throw new Error(`Artifact at ${path} is missing abi or bytecode. Run: npx hardhat compile`);
  }
  return { abi: json.abi, bytecode: json.bytecode as `0x${string}` };
}

// Assert that a contract call reverts with a specific custom error. It
// simulates first so no gas is spent and no tx is broadcast: a negative proof
// should never touch chain state. Returns the actual error name for logging.
async function expectRevert(
  publicClient: ReturnType<typeof createPublicClient>,
  params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args: unknown[];
    account: `0x${string}`;
    value?: bigint;
  },
  expectedError: string,
): Promise<string> {
  try {
    await publicClient.simulateContract(params as never);
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const name = revert.data?.errorName ?? "(unnamed revert)";
        if (name !== expectedError) {
          throw new Error(`Expected revert ${expectedError} but got ${name}`);
        }
        return name;
      }
    }
    throw new Error(
      `Expected revert ${expectedError} but got a non-revert error: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  throw new Error(`Expected revert ${expectedError} but the call succeeded`);
}

async function main() {
  const rpcUrl = requireEnv("RESVYN_RPC_URL");
  const deployerKey = requireEnv("RESVYN_DEPLOYER_KEY") as `0x${string}`;
  // Claimant is optional. If omitted, an ephemeral claimant is generated and
  // funded from the deployer, so a single funded deployer key runs the whole
  // rehearsal end to end (the claimant only needs a little gas for openClaim).
  const claimantKey = (process.env.RESVYN_CLAIMANT_KEY?.trim() ??
    generatePrivateKey()) as `0x${string}`;
  const claimantWasGenerated = !process.env.RESVYN_CLAIMANT_KEY?.trim();
  const evaluatorKey = (process.env.RESVYN_EVALUATOR_KEY?.trim() ??
    generatePrivateKey()) as `0x${string}`;
  const evaluatorWasGenerated = !process.env.RESVYN_EVALUATOR_KEY?.trim();

  const depositAmount = parseAmount("RESVYN_DEPOSIT", "0.005");
  const maxPayout = parseAmount("RESVYN_MAX_PAYOUT", "0.001");
  const approveAmount = parseAmount("RESVYN_APPROVE_AMOUNT", "0.001");
  // How much the deployer sends an ephemeral claimant to cover openClaim gas.
  const claimantFunding = parseAmount("RESVYN_CLAIMANT_FUNDING", "0.02");

  if (approveAmount > maxPayout) {
    throw new Error(
      `RESVYN_APPROVE_AMOUNT (${formatEther(approveAmount)}) exceeds ` +
        `RESVYN_MAX_PAYOUT (${formatEther(maxPayout)}).`,
    );
  }
  if (maxPayout > depositAmount) {
    throw new Error(
      `RESVYN_MAX_PAYOUT (${formatEther(maxPayout)}) exceeds ` +
        `RESVYN_DEPOSIT (${formatEther(depositAmount)}); issuance would revert.`,
    );
  }

  // Probe the chain id before touching keys, so a wrong RPC fails loudly.
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();

  if (chainId === MAINNET_CHAIN_ID && process.env.RESVYN_ALLOW_MAINNET !== "i-understand") {
    throw new Error(
      "Refusing to run the rehearsal on BOT Mainnet (chain 677). This tool " +
        "deploys and spends. The Mainnet proof is a deliberate deploy-once " +
        "ceremony. Set RESVYN_ALLOW_MAINNET=i-understand only if that is " +
        "genuinely your intent.",
    );
  }
  if (chainId !== EXPECTED_TESTNET_CHAIN_ID && chainId !== MAINNET_CHAIN_ID) {
    console.log(
      `Note: connected to chain ${chainId}, which is neither BOT Testnet ` +
        `(968) nor Mainnet (677). Proceeding (local validation node?).`,
    );
  }

  const chain = defineChain({
    id: chainId,
    name: `bot-${chainId}`,
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const deployer = privateKeyToAccount(deployerKey);
  const claimant = privateKeyToAccount(claimantKey);
  const evaluator = privateKeyToAccount(evaluatorKey);

  const merchantClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
  const claimantClient = createWalletClient({ account: claimant, chain, transport: http(rpcUrl) });

  console.log("Resvyn dress rehearsal");
  console.log(`  chainId:   ${chainId}`);
  console.log(`  rpc:       ${rpcUrl}`);
  console.log(`  deployer/merchant/relayer: ${deployer.address}`);
  console.log(
    `  claimant (payout target):  ${claimant.address}` +
      (claimantWasGenerated ? "  (ephemeral, generated for this run)" : ""),
  );
  console.log(
    `  evaluator signer:          ${evaluator.address}` +
      (evaluatorWasGenerated ? "  (ephemeral, generated for this run)" : ""),
  );
  console.log(
    `  amounts: deposit ${formatEther(depositAmount)}  maxPayout ` +
      `${formatEther(maxPayout)}  approve ${formatEther(approveAmount)} BOT`,
  );

  // Pre-flight balances so a zero-funded run fails before deploying.
  const deployerBal = await publicClient.getBalance({ address: deployer.address });
  let claimantBal = await publicClient.getBalance({ address: claimant.address });
  console.log(
    `\n  deployer balance: ${formatEther(deployerBal)} BOT` +
      `\n  claimant balance: ${formatEther(claimantBal)} BOT`,
  );
  if (deployerBal === 0n) throw new Error("Deployer has zero balance; fund it from the faucet.");

  // Bootstrap: if the claimant can't pay for openClaim, the deployer funds it.
  // Only auto-fund a claimant we generated, so a supplied key is never topped
  // up behind the operator's back.
  if (claimantBal === 0n) {
    if (!claimantWasGenerated) {
      throw new Error(
        "Supplied RESVYN_CLAIMANT_KEY has zero balance; it needs gas for " +
          "openClaim. Fund it, or omit it to auto-generate and fund one.",
      );
    }
    console.log(
      `\n[0/5] Funding ephemeral claimant with ${formatEther(claimantFunding)} BOT ` +
        "from the deployer...",
    );
    const fundHash = await merchantClient.sendTransaction({
      to: claimant.address,
      value: claimantFunding,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    claimantBal = await publicClient.getBalance({ address: claimant.address });
    console.log(
      `      claimant funded: ${formatEther(claimantBal)} BOT  (tx ${fundHash})`,
    );
  }
  if (claimantBal === 0n) throw new Error("Claimant has zero balance; it needs gas for openClaim.");

  const { abi, bytecode } = await loadArtifact();

  // 1) Deploy with the evaluator address (immutable signer).
  console.log("\n[1/5] Deploying WarrantyReserve...");
  const deployHash = await merchantClient.deployContract({
    abi,
    bytecode,
    args: [evaluator.address],
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const reserveAddress = deployReceipt.contractAddress as `0x${string}`;
  console.log(`      deployed at ${reserveAddress}  (tx ${deployHash})`);

  const read = (functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: reserveAddress, abi, functionName, args });

  // 2) Merchant deposits reserve.
  console.log("[2/5] Depositing reserve...");
  const depositHash = await merchantClient.writeContract({
    address: reserveAddress,
    abi,
    functionName: "depositReserve",
    args: [],
    value: depositAmount,
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`      deposited ${formatEther(depositAmount)} BOT  (tx ${depositHash})`);

  // 3) Merchant issues coverage to the claimant (locks maxPayout).
  console.log("[3/5] Issuing coverage...");
  const futureExpiry = BigInt((await publicClient.getBlock()).timestamp) + 365n * 24n * 3600n;
  const issueHash = await merchantClient.writeContract({
    address: reserveAddress,
    abi,
    functionName: "issueCoverage",
    args: [claimant.address, PRODUCT_HASH, RECEIPT_HASH, maxPayout, futureExpiry],
  });
  await publicClient.waitForTransactionReceipt({ hash: issueHash });
  const coverageId = (await read("coverageCount")) as bigint;
  const afterIssue = (await read("reserveOf", [deployer.address])) as [bigint, bigint, bigint];
  console.log(
    `      coverage #${coverageId} issued  locked=${formatEther(afterIssue[1])}  (tx ${issueHash})`,
  );
  if (afterIssue[1] !== maxPayout) {
    throw new Error(`Lock mismatch: expected ${formatEther(maxPayout)}, got ${formatEther(afterIssue[1])}`);
  }

  // 4) Claimant opens the claim.
  console.log("[4/5] Opening claim...");
  const openHash = await claimantClient.writeContract({
    address: reserveAddress,
    abi,
    functionName: "openClaim",
    args: [coverageId, EVIDENCE_HASH],
  });
  await publicClient.waitForTransactionReceipt({ hash: openHash });
  const claimId = (await read("claimCount")) as bigint;
  console.log(`      claim #${claimId} opened  (tx ${openHash})`);

  // 5) Evaluator SERVICE decides + signs; relayer resolves; payout lands.
  //    The decision is not hardcoded here: structured evidence goes through the
  //    same policy -> schema-validate -> bind -> sign path the plan defines, and
  //    the contract verifies the signature. A clean-eligible fixture drives an
  //    approval for approveAmount (<= the coverage cap, so the policy approves).
  console.log("[5/5] Evaluating + signing + resolving (approve)...");
  const nowTs = BigInt((await publicClient.getBlock()).timestamp);
  const evidence: ClaimEvidence = {
    productMatches: true,
    damageEligible: true,
    evidenceComplete: true,
    fileIntegrityOk: true,
    issuedAt: nowTs - 3600n,
    requestedAmount: approveAmount,
    evidenceHash: EVIDENCE_HASH,
  };
  const binding: DecisionBinding = {
    chainId: BigInt(chainId),
    verifier: reserveAddress,
    claimId,
    coverageId,
    claimant: claimant.address,
    evidenceHash: EVIDENCE_HASH,
    nonce: 1n,
    maxPayout,
    asOf: nowTs,
    // Rehearsal/proof: keep the decision valid through settlement in one run.
    decisionTtl: futureExpiry - nowTs,
  };
  const evaluation = await evaluateAndSign(evidence, binding, evaluator);
  const { decision, signature, model } = evaluation;
  console.log(
    `      evaluator decision: ${model.decision} (${model.reasonCode}) ` +
      `amount=${formatEther(decision.amount)} BOT  result=${decision.result}`,
  );
  if (decision.result !== APPROVE) {
    throw new Error(
      `Rehearsal expected an APPROVE from the evaluator but got result ${decision.result} ` +
        `(${model.reasonCode}). Check the fixture evidence.`,
    );
  }

  const claimantBefore = await publicClient.getBalance({ address: claimant.address });
  const resolveHash = await merchantClient.writeContract({
    address: reserveAddress,
    abi,
    functionName: "resolveClaim",
    args: [decision, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash: resolveHash });
  const claimantAfter = await publicClient.getBalance({ address: claimant.address });
  console.log(`      resolved  (tx ${resolveHash})`);

  // ---- On-chain assertions: the winning invariant held ----
  const claim = (await read("claimOf", [claimId])) as {
    status: number;
    paidAmount: bigint;
  };
  const nonceUsed = (await read("isNonceUsed", [1n])) as boolean;
  const finalAcct = (await read("reserveOf", [deployer.address])) as [bigint, bigint, bigint];
  const payoutDelta = claimantAfter - claimantBefore;

  console.log("\nResult:");
  console.log(`  claim status:        ${claim.status} (2 = Approved)`);
  console.log(`  paid amount:         ${formatEther(claim.paidAmount)} BOT`);
  console.log(`  claimant delta:      ${formatEther(payoutDelta)} BOT`);
  console.log(`  nonce burned:        ${nonceUsed}`);
  console.log(
    `  merchant accounting: balance=${formatEther(finalAcct[0])} ` +
      `locked=${formatEther(finalAcct[1])} free=${formatEther(finalAcct[2])} BOT`,
  );

  const problems: string[] = [];
  if (claim.status !== 2) problems.push(`claim not Approved (status ${claim.status})`);
  if (claim.paidAmount !== approveAmount) problems.push("paidAmount != approve amount");
  if (payoutDelta !== approveAmount) problems.push("claimant balance delta != approve amount");
  if (!nonceUsed) problems.push("nonce was not burned");
  if (finalAcct[1] !== 0n) problems.push(`lock not released (locked ${formatEther(finalAcct[1])})`);
  // Full lock released even on a partial payout: balance drops by exactly the
  // amount paid, and free == balance (nothing left locked).
  if (finalAcct[0] !== depositAmount - approveAmount) problems.push("merchant balance off");
  if (finalAcct[2] !== finalAcct[0]) problems.push("free != balance after full release");

  if (problems.length > 0) {
    throw new Error(`Rehearsal FAILED:\n  - ${problems.join("\n  - ")}`);
  }

  // ---- Negative proofs (the judge demo's "duplicate failure" and
  // "underfunded issuance failure"). Both are simulated (eth_call), so they
  // prove the guard rejects the operation without spending gas or changing
  // state - which is exactly the property being proven. ----
  console.log("\nNegative proofs (call-level, no state change):");

  // A) Duplicate settlement: replay the exact same signed decision. The nonce
  //    is already burned, so resolveClaim reverts NonceAlreadyUsed. This is
  //    what stops a second payout for one decision.
  const dupErr = await expectRevert(
    publicClient,
    {
      address: reserveAddress,
      abi,
      functionName: "resolveClaim",
      args: [decision, signature],
      account: deployer.address,
    },
    "NonceAlreadyUsed",
  );
  console.log(`  duplicate settlement rejected: ${dupErr}`);

  // B) Underfunded issuance: try to issue coverage whose maxPayout exceeds the
  //    remaining free reserve by 1 wei. Reverts InsufficientFreeReserve - the
  //    winning invariant, "no funded reserve, no valid coverage".
  const overCommit = finalAcct[2] + 1n; // free reserve + 1 wei
  const underErr = await expectRevert(
    publicClient,
    {
      address: reserveAddress,
      abi,
      functionName: "issueCoverage",
      args: [claimant.address, PRODUCT_HASH, RECEIPT_HASH, overCommit, futureExpiry],
      account: deployer.address,
    },
    "InsufficientFreeReserve",
  );
  console.log(
    `  underfunded issuance rejected: ${underErr} ` +
      `(tried to lock ${formatEther(overCommit)} against ${formatEther(finalAcct[2])} free)`,
  );

  // ---- Optional reclaim (Mainnet cleanup). OFF by default: a Testnet
  // rehearsal spends valueless tBOT, so leaving the free reserve in the
  // contract is harmless and CP-007's proven behavior stays unchanged. On the
  // Mainnet proof, set RESVYN_RECLAIM=1 so the ceremony leaves no real BOT
  // stranded: the payout already released the lock, so the whole free balance
  // (deposit - payout) is withdrawable straight back to the merchant. It also
  // doubles as a live proof that withdrawReserve honors the lock accounting. ----
  if (process.env.RESVYN_RECLAIM === "1") {
    const free = finalAcct[2]; // balance - locked, after the payout
    if (free === 0n) {
      console.log("\nReclaim: free reserve already zero, nothing to withdraw.");
    } else {
      console.log(`\nReclaiming free reserve (${formatEther(free)} BOT) to the merchant...`);
      const merchantBefore = await publicClient.getBalance({ address: deployer.address });
      const withdrawHash = await merchantClient.writeContract({
        address: reserveAddress,
        abi,
        functionName: "withdrawReserve",
        args: [free],
      });
      await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
      const afterAcct = (await read("reserveOf", [deployer.address])) as [bigint, bigint, bigint];
      const merchantAfter = await publicClient.getBalance({ address: deployer.address });
      console.log(`      withdrawn  (tx ${withdrawHash})`);
      console.log(
        `      reserve now: balance=${formatEther(afterAcct[0])} ` +
          `locked=${formatEther(afterAcct[1])} free=${formatEther(afterAcct[2])} BOT`,
      );
      if (afterAcct[2] !== 0n) {
        throw new Error(`Reclaim failed: free reserve still ${formatEther(afterAcct[2])} BOT`);
      }
      if (afterAcct[0] !== finalAcct[0] - free) throw new Error("Reclaim accounting off");
      console.log(
        `      merchant EOA delta (net of gas): ${formatEther(merchantAfter - merchantBefore)} BOT`,
      );
    }
  }

  console.log(
    `\nPASS. fund -> issue -> claim -> payout completed on chain ${chainId}, ` +
      "plus duplicate-settlement and underfunded-issuance both rejected. " +
      "Full lock released, payout delivered, nonce terminal.",
  );
  // A local node can also report chain 968, so label by RPC host, not chain id
  // alone. Local output is a simulation and must never be read as live proof.
  const isLocal = /(^https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0)/i.test(rpcUrl);
  if (isLocal) {
    console.log(
      "This ran against a LOCAL node. It validates the script only. It is " +
        "NOT a Testnet run and NOT a Mainnet proof.",
    );
  } else if (chainId === EXPECTED_TESTNET_CHAIN_ID) {
    console.log(
      "This was a Testnet rehearsal (valueless tBOT). It is NOT a Mainnet proof.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
