import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Resvyn · Privacy",
  description: "How the Resvyn web app handles data.",
}

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)", maxWidth: 800 }}>
        <span className="kicker">Privacy</span>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
          What this app does with data.
        </h1>
        <div style={{ marginTop: 28, color: "var(--color-muted)", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 16 }}>
          <p>
            Landing, /demo, /proof, and /reserve read public chain data in your browser. They do not create an account and they do not ask for a password.
          </p>
          <p>
            /app talks to an injected wallet only after you choose Connect. Wallet addresses and transaction hashes are public on BOT Chain. Do not treat them as private.
          </p>
          <p>
            If you request a signed claim decision, the server reads the live claim and coverage from the chain. It does not need your private key. An evaluator signing key, when configured, stays on the server.
          </p>
          <p>
            This prototype does not run ads, does not sell personal data, and does not keep a user profile database. Hosting logs may record IP addresses for a short time.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
