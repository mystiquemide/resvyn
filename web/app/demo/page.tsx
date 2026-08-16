import type { Metadata } from "next"
import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import StatusDot from "@/components/StatusDot"
import DemoWalkthrough from "@/components/DemoWalkthrough"

export const metadata: Metadata = {
  title: "RWA Warranty Demo · Resvyn",
  description:
    "Walk through the Resvyn RWA warranty loop: merchant reserve, buyer-bound coverage, claim, bounded AI decision, payout and reserve reconciliation.",
}

export default function DemoPage() {
  return (
    <>
      <Nav />

      <div
        style={{
          position: "sticky",
          top: 68,
          zIndex: 40,
          background: "color-mix(in srgb, #c98a1a 12%, var(--color-canvas))",
          borderBottom: "1px solid color-mix(in srgb, #c98a1a 34%, transparent)",
        }}
      >
        <div
          className="container-x"
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, flexWrap: "wrap", paddingBlock: 8 }}
        >
          <StatusDot tone="warn" />
          <span style={{ fontSize: "0.86rem", color: "var(--color-ink)", fontWeight: 500 }}>
            Guided simulation of the real warranty business loop. Amounts mirror the recorded Mainnet run.
          </span>
          <Link href="/proof" className="link-teal" style={{ fontSize: "0.86rem", marginLeft: "auto" }}>
            Verify the Mainnet receipts
          </Link>
        </div>
      </div>

      <main id="main">
        <DemoWalkthrough />
      </main>
      <Footer />
    </>
  )
}
