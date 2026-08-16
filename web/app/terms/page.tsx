import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Resvyn · Terms",
  description: "Terms of use for the Resvyn prototype.",
}

export default function TermsPage() {
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)", maxWidth: 800 }}>
        <span className="kicker">Terms</span>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
          Use this prototype carefully.
        </h1>
        <div style={{ marginTop: 28, color: "var(--color-muted)", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 16 }}>
          <p>
            Resvyn is a software prototype built for the BOT Chain hackathon. It is not insurance, not a regulated warranty product, and not an offer of financial services.
          </p>
          <p>
            /app is read-only for the recorded Mainnet proof deployment. Native BOT you might deposit can only be locked or paid out on a fresh operational deployment, and this app keeps those writes disabled until an operator explicitly enables them (NEXT_PUBLIC_RESVYN_OPERATIONAL=1). Do not send funds you cannot afford to lose.
          </p>
          <p>
            The recorded Mainnet ceremony is independently verifiable on /proof. New claim settlement on that instance requires the original evaluator signer, which is no longer in use. A later deploy would be a different contract.
          </p>
          <p>
            You are responsible for your wallet, your network selection, and any transaction you sign. Resvyn does not custody keys in the browser.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
