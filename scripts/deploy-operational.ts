import { readFile } from "node:fs/promises";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 677;
const DEFAULT_RPC = "https://rpc.botchain.ai";
const ARTIFACT = new URL(
  "../artifacts/contracts/WarrantyReserve.sol/WarrantyReserve.json",
  import.meta.url,
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key`);
  }
  return value as Hex;
}

async function main() {
  const rpcUrl = process.env.BOT_MAINNET_RPC_URL?.trim() || DEFAULT_RPC;
  const deployer = privateKeyToAccount(privateKey("RESVYN_DEPLOYER_KEY"));
  const evaluatorRaw = required("RESVYN_EVALUATOR_ADDRESS");

  if (!isAddress(evaluatorRaw)) throw new Error("RESVYN_EVALUATOR_ADDRESS is not a valid address");
  const evaluator = getAddress(evaluatorRaw) as Address;
  if (evaluator === zeroAddress) throw new Error("RESVYN_EVALUATOR_ADDRESS cannot be the zero address");

  const chain = defineChain({
    id: CHAIN_ID,
    name: "BOT Chain Mainnet",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "BOTScan", url: "https://scan.botchain.ai" } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== CHAIN_ID) {
    throw new Error(`refusing deployment: RPC reports chain ${liveChainId}, expected ${CHAIN_ID}`);
  }

  const balance = await publicClient.getBalance({ address: deployer.address });
  if (balance === 0n) {
    throw new Error("deployer has zero BOT; fund the deployment wallet before continuing");
  }

  const artifact = JSON.parse(await readFile(ARTIFACT, "utf8")) as {
    abi: readonly unknown[];
    bytecode: Hex;
  };
  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error("compiled WarrantyReserve bytecode is missing; run npm run compile first");
  }

  const walletClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

  console.log("Resvyn operational deployment preflight");
  console.log(`chain: ${liveChainId}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`deployer balance: ${formatEther(balance)} BOT`);
  console.log(`evaluator: ${evaluator}`);

  const hash = await walletClient.deployContract({
    account: deployer,
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [evaluator],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress;
  if (!address) throw new Error("deployment receipt did not contain a contract address");

  const onchainEvaluator = await publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName: "evaluatorSigner",
  });
  if (typeof onchainEvaluator !== "string" || getAddress(onchainEvaluator) !== evaluator) {
    throw new Error("deployment verification failed: evaluatorSigner does not match the requested evaluator");
  }

  console.log("\nDeployment verified");
  console.log(`contract: ${address}`);
  console.log(`transaction: ${hash}`);
  console.log(`block: ${receipt.blockNumber}`);
  console.log(`explorer: https://scan.botchain.ai/address/${address}`);
  console.log("\nNext: verify source on BOTScan, set the web deployment manifest, then run a small live lifecycle rehearsal.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
