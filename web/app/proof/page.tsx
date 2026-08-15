import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import ProofVerifier from "@/components/ProofVerifier"
import { PROOF, explorerAddress } from "@/lib/chain"
import { shortHash } from "@/lib/format"

export const metadata: Metadata = {
  title: "Mainnet proof · Resvyn",
  description:
    "The Resvyn warranty reserve, deployed and settled on BOT Chain Mainnet (chain 677). Every value on this page is read live from the chain in your browser and reconciled against the recorded proof.",
}

export default function ProofPage() {
  const contractUrl = explorerAddress(677, PROOF.contract)
  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)" }}>
        {/* header */}
        <header style={{ maxWidth: 820 }}>
          <span className="kicker">Mainnet proof</span>
          <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
            Deployed, settled, and <span className="em">verifiable live.</span>
          </h1>
          <p className="lead" style={{ marginTop: 16 }}>
            A merchant must lock native BOT before it can issue product coverage. A bounded AI evaluator signs each settlement, and the contract pays
            the buyer directly from the locked reserve. This page reads the live contract on BOT Chain Mainnet and reconciles every value against the
            recorded proof. Nothing here is hardcoded state. The badges turn green only when the live chain agrees.
          </p>

          <div
            className="pill"
            style={{
              marginTop: 18,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "var(--color-teal-ink)",
              background: "color-mix(in srgb, var(--color-teal) 12%, #fff)",
              borderColor: "color-mix(in srgb, var(--color-teal) 30%, transparent)",
              fontSize: "0.82rem",
            }}
          >
            invariant: no funded reserve and no valid coverage
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px", marginTop: 20, fontSize: "0.88rem" }}>
            <Meta label="Network" value="BOT Chain Mainnet" />
            <Meta label="Chain ID" value="677" />
            <div>
              <span style={{ color: "var(--color-muted)" }}>Contract </span>
              <a className="mono link-teal" href={contractUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem" }}>
                {shortHash(PROOF.contract)}
              </a>
            </div>
            <div>
              <span style={{ color: "var(--color-muted)" }}>Source </span>
              <a className="link-teal" href={`${contractUrl}?tab=contract`} target="_blank" rel="noopener noreferrer">
                verified on BOTScan
              </a>
            </div>
          </div>
        </header>

        <ProofVerifier />
      </main>
      <Footer />
    </>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: "var(--color-muted)" }}>{label} </span>
      <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{value}</span>
    </div>
  )
}
