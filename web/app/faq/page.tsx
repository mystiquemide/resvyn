import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "FAQ · Resvyn",
  description: "How Resvyn reserves, coverage, and Mainnet proof work.",
}

const ITEMS = [
  {
    q: "What is Resvyn?",
    a: "A warranty reserve on BOT Chain Mainnet. A merchant funds native BOT, coverage locks its maximum payout, and a bounded AI decision can settle a claim from that lock.",
  },
  {
    q: "Where is it deployed?",
    a: "BOT Chain Mainnet, chain 677. The recorded proof contract is 0x414592d2313d233b673b1f97803c261355ccd996. Source is verified on BOTScan.",
  },
  {
    q: "What is /proof versus /app?",
    a: "/proof re-reads the recorded Mainnet ceremony in your browser. /app is the live workspace for funding, issuing, and claims. /demo is simulated and never touches a chain.",
  },
  {
    q: "Can I look up any merchant?",
    a: "Yes. Use Look up a reserve, paste an address, and Resvyn reads reserveOf on Mainnet. No wallet is required.",
  },
  {
    q: "Why might settlement fail?",
    a: "The evaluator signer on the recorded contract was bound at deploy and cannot be rotated. A new Mainnet deploy is required before live AI settlement can run again.",
  },
]

export default function FaqPage() {
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)", maxWidth: 800 }}>
        <span className="kicker">FAQ</span>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
          Questions, answered plainly.
        </h1>
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column" }}>
          {ITEMS.map((item) => (
            <details
              key={item.q}
              style={{
                borderBottom: "1px solid var(--color-hairline)",
                padding: "16px 2px",
              }}
            >
              <summary
                style={{
                  fontWeight: 600,
                  fontSize: "1.05rem",
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                {item.q}
              </summary>
              <p style={{ margin: "10px 0 0", color: "var(--color-muted)", lineHeight: 1.6, maxWidth: 640 }}>
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </main>
      <Footer />
    </>
  )
}
