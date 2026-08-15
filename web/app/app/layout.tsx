import type { Metadata } from "next"
import Providers from "@/components/Providers"

export const metadata: Metadata = {
  title: "App · Resvyn",
  description:
    "Run the Resvyn warranty-reserve lifecycle on BOT Chain Mainnet: fund a reserve, issue coverage that locks its payout, open a claim, and settle it with a bounded AI-signed decision.",
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
