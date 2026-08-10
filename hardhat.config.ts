import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Milestone 2/3 configuration adds the BOT Chain networks. Both entries are
// config only: they define the network and read the RPC URL from an env var.
// They perform no deployment and fund no wallet. Accounts are intentionally
// omitted so no signing key is referenced here; the deployer/relayer key is
// supplied at run time by the operator, never stored in the repo.
//   botMainnet (chain 677): the single Mainnet proof target.
//   botTestnet (chain 968): the free dress-rehearsal target (valueless tBOT).
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
    botTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 968,
      url: configVariable("BOT_TESTNET_RPC_URL"),
    },
  },
});
