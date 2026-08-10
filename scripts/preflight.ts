import { network } from "hardhat";
import { formatEther, isAddress } from "viem";

// BOT Mainnet preflight (read only). Confirms the botMainnet connection reaches
// chain ID 677 and reports the native BOT balance of each address supplied in
// the BOT_PREFLIGHT_ADDRESSES env var (comma-separated). It reads public chain
// state only: no private key is used, no keystore is opened, and no transaction
// is ever sent. This is the tool that clears BLK-001 once the deployer,
// merchant, and buyer addresses are known.
//
// Usage:
//   BOT_MAINNET_RPC_URL=<rpc> \
//   BOT_PREFLIGHT_ADDRESSES=0xdeployer,0xmerchant,0xbuyer \
//   npx hardhat run scripts/preflight.ts --network botMainnet

const EXPECTED_CHAIN_ID = 677;

async function main() {
  const raw = process.env.BOT_PREFLIGHT_ADDRESSES ?? "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const invalid = addresses.filter((a) => !isAddress(a));
  if (invalid.length > 0) {
    throw new Error(`Not valid addresses: ${invalid.join(", ")}`);
  }

  const connection = await network.connect({
    network: "botMainnet",
    chainType: "l1",
  });
  const client = await connection.viem.getPublicClient();

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();

  console.log(`Connected to botMainnet`);
  console.log(`  chainId:     ${chainId}`);
  console.log(`  blockNumber: ${blockNumber}`);

  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong chain: expected ${EXPECTED_CHAIN_ID}, connected to ${chainId}. ` +
        `Check BOT_MAINNET_RPC_URL.`,
    );
  }

  if (addresses.length === 0) {
    console.log(
      "\nNo addresses to check. Set BOT_PREFLIGHT_ADDRESSES to a " +
        "comma-separated list to confirm balances.",
    );
    return;
  }

  console.log(`\nBalances on chain ${chainId}:`);
  for (const address of addresses) {
    const [balance, code] = await Promise.all([
      client.getBalance({ address }),
      client.getCode({ address }),
    ]);
    const kind = code && code !== "0x" ? "contract" : "EOA";
    console.log(`  ${address}  ${formatEther(balance)} BOT  (${kind})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
