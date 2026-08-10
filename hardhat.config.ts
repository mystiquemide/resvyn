import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Milestone 2 configuration adds the BOT Chain Mainnet network (chain ID 677).
// This entry is config only: it defines the network and reads its RPC URL from
// the BOT_MAINNET_RPC_URL environment variable. It performs no deployment and
// funds no wallet. Accounts are intentionally omitted until BLK-001 (Mainnet
// wallet roles and BOT balances) is resolved, so no signing key is referenced.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    botMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 677,
      url: configVariable("BOT_MAINNET_RPC_URL"),
    },
  },
});
