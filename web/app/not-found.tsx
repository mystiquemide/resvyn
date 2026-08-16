import type { Metadata } from "next"
import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Resvyn · Page not found",
  description: "This page could not be found.",
}

export default function NotFound() {
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(48px, 7vw, 88px)", textAlign: "center", maxWidth: 640 }}>
        <span className="kicker">404</span>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
          This page could not be found.
        </h1>
        <p className="lead" style={{ marginTop: 16 }}>
          The reserve is still here, but this address is not. Head back to the
          landing page or jump straight to the proof.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
          <Link href="/proof" className="btn btn-ghost">
            View Mainnet proof
          </Link>
        </div>
      </main>
      <Footer />
    </>
  )
}
