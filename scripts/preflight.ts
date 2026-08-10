import { network } from "hardhat";
import { formatEther, isAddress } from "viem";

// BOT preflight (read only). Confirms the connection reaches the expected chain
// and reports the native BOT balance of each address supplied in the
// BOT_PREFLIGHT_ADDRESSES env var (comma-separated). It reads public chain
// state only: no private key is used, no keystore is opened, and no transaction
// is ever sent. This is the tool that clears BLK-001 once the deployer,
// merchant, and buyer addresses are known, and the same tool that confirms
// tBOT funding before the Testnet rehearsal.
//
// Network selection: set BOT_PREFLIGHT_NETWORK to botMainnet (default, chain
// 677) or botTestnet (chain 968). Hardhat 3's `run` does not forward its
// --network flag to network.connect(), so selection is explicit via this env
// var. The expected chain id is derived from it, so a wrong RPC URL fails
// loudly instead of silently checking balances on the wrong chain.
//
// Usage (Mainnet):
//   BOT_MAINNET_RPC_URL=<rpc> \
//   BOT_PREFLIGHT_ADDRESSES=0xdeployer,0xmerchant,0xbuyer \
//   npx hardhat run scripts/preflight.ts --network botMainnet
//
// Usage (Testnet):
//   BOT_PREFLIGHT_NETWORK=botTestnet \
//   BOT_TESTNET_RPC_URL=https://rpc.bohr.life \
//   BOT_PREFLIGHT_ADDRESSES=0xdeployer,0xmerchant,0xbuyer \
//   npx hardhat run scripts/preflight.ts --network botTestnet

const EXPECTED_CHAIN_ID: Record<string, number> = {
  botMainnet: 677,
  botTestnet: 968,
};

async function main() {
  // Explicit network selection (see header). Default botMainnet so existing
  // Mainnet usage is unchanged.
  const networkName = process.env.BOT_PREFLIGHT_NETWORK ?? "botMainnet";
  const expectedChainId = EXPECTED_CHAIN_ID[networkName];
  if (expectedChainId === undefined) {
    throw new Error(
      `Unknown network "${networkName}". Set BOT_PREFLIGHT_NETWORK to ` +
        `botMainnet or botTestnet.`,
    );
  }

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
    network: networkName,
    chainType: "l1",
  });
  const client = await connection.viem.getPublicClient();

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();
  const gasPrice = await client.getGasPrice();

  console.log(`Connected to ${networkName}`);
  console.log(`  chainId:     ${chainId}`);
  console.log(`  blockNumber: ${blockNumber}`);
  console.log(`  gasPrice:    ${formatEther(gasPrice)} BOT`);

  if (chainId !== expectedChainId) {
    throw new Error(
      `Wrong chain: expected ${expectedChainId} for ${networkName}, ` +
        `connected to ${chainId}. Check the RPC URL env var.`,
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
