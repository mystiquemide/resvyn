import type { Metadata } from "next"
import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import StatusDot from "@/components/StatusDot"
import DemoWalkthrough from "@/components/DemoWalkthrough"

export const metadata: Metadata = {
  title: "Demo · Resvyn",
  description:
    "A simulated, step-by-step walkthrough of the Resvyn warranty-reserve lifecycle. Every amount mirrors the real Mainnet proof run, but nothing here touches a chain.",
}

export default function DemoPage() {
  return (
    <>
      <Nav />

      {/* Permanent honesty banner. This surface is never Mainnet proof. */}
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
            Simulated walkthrough. Numbers mirror the real Mainnet proof, but nothing here touches a chain.
          </span>
          <Link href="/proof" className="link-teal" style={{ fontSize: "0.86rem", marginLeft: "auto" }}>
            See the real proof
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
