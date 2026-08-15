import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import ReserveLookup from "@/components/ReserveLookup"

export const metadata: Metadata = {
  title: "Look up a reserve · Resvyn",
  description:
    "Paste a merchant address and read their Resvyn reserve live from BOT Chain Mainnet. No wallet required.",
}

export default function ReservePage() {
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)" }}>
        <ReserveLookup />
      </main>
      <Footer />
    </>
  )
}
