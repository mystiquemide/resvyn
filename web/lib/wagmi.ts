import { createConfig, http } from "wagmi"
import { injected } from "wagmi/connectors"
import { APP_CHAIN } from "./chain"

/**
 * wagmi config for /app. One chain only: BOT Chain Mainnet (677).
 * Injected connector (MetaMask and any EIP-1193 wallet).
 */
export const wagmiConfig = createConfig({
  chains: [APP_CHAIN],
  connectors: [injected()],
  transports: {
    [APP_CHAIN.id]: http(),
  },
  ssr: true,
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}
