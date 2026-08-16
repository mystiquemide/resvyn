import type { Metadata } from "next"
import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import CurrentProofVerifier from "@/components/CurrentProofVerifier"
import { CURRENT_DEPLOYMENT, PROOF, explorerAddress, explorerTx } from "@/lib/chain"
import { CURRENT_PROOF } from "@/lib/currentProof"
import { shortHash } from "@/lib/format"

export const metadata: Metadata = {
  title: "Resvyn · Mainnet proof",
  description:
    "Verify Resvyn's complete current BOT Chain Mainnet lifecycle: funded reserve, buyer-bound coverage, durable evidence, evaluator-authorized payout, and reserve reconciliation.",
}

export default function ProofPage() {
  const currentContractUrl = explorerAddress(677, CURRENT_DEPLOYMENT.contract)
  const archivedContractUrl = explorerAddress(677, PROOF.contract)
  const resolve = CURRENT_PROOF.txs.find((tx) => tx.key === "resolve")!

  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)" }}>
        <header style={{ maxWidth: 900 }}>
          <span className="kicker">Current Mainnet proof</span>
          <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
            The production contract completed <span className="em">the full warranty lifecycle.</span>
          </h1>
          <p className="lead" style={{ marginTop: 16 }}>
            This is the hardened Resvyn deployment that the live app uses today. A fresh merchant funded a native BOT reserve, issued buyer-bound coverage to a separate buyer, the buyer opened an evidence-bound claim, the durable VPS evaluator authorized a real payout, and the merchant reserve reconciled back to zero.
          </p>
          <div className="pill" style={{ marginTop: 18, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--color-teal-ink)", background: "color-mix(in srgb, var(--color-teal) 12%, #fff)", borderColor: "color-mix(in srgb, var(--color-teal) 30%, transparent)", fontSize: "0.82rem" }}>
            no funded reserve and no valid coverage
          </div>
        </header>

        <section style={{ marginTop: 30 }} aria-labelledby="primary-proof-title">
          <div className="card" style={{ padding: "22px 24px", maxWidth: 980 }}>
            <div style={{ display: "flex", gap: 18, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span className="kicker" style={{ color: "var(--color-teal-ink)" }}>Primary proof · current deployment</span>
                <h2 id="primary-proof-title" style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 500 }}>
                  Hardened WarrantyReserve · chain 677
                </h2>
                <p style={{ margin: "8px 0 0", color: "var(--color-muted)", lineHeight: 1.55, maxWidth: 730 }}>
                  Source verified on BOTScan and operational in production. The proof below re-reads the current contract, the five lifecycle receipts, the consumed settlement nonce, and the durable evidence record instead of relying on screenshots.
                </p>
              </div>
              <Link href="/app" className="btn btn-primary" style={{ flex: "none" }}>
                Open live app
              </Link>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginTop: 20, minWidth: 0 }}>
              <DeploymentFact label="Contract" value={shortHash(CURRENT_PROOF.contract)} href={currentContractUrl} />
              <DeploymentFact label="Merchant" value={shortHash(CURRENT_PROOF.merchant)} />
              <DeploymentFact label="Buyer" value={shortHash(CURRENT_PROOF.buyer)} />
              <DeploymentFact label="Evaluator" value={shortHash(CURRENT_PROOF.evaluator)} />
              <DeploymentFact label="Claim payout" value="0.0005 BOT" href={explorerTx(677, resolve.hash)} />
              <DeploymentFact label="Final merchant reserve" value="0 / 0 / 0" />
            </div>
          </div>
        </section>

        <CurrentProofVerifier />

        <section style={{ marginTop: 56 }} aria-labelledby="historical-proof-title">
          <div className="card" style={{ padding: "22px 24px", maxWidth: 980 }}>
            <span className="kicker">Historical proof</span>
            <h2 id="historical-proof-title" style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem, 3vw, 1.8rem)", fontWeight: 500 }}>
              Earlier Mainnet lifecycle retained as an archive
            </h2>
            <p style={{ color: "var(--color-muted)", margin: "10px 0 0", maxWidth: 790, lineHeight: 1.55 }}>
              Resvyn also preserves the earlier disposable lifecycle at a separate contract. It remains useful historical evidence, but it is no longer the primary proof and is never treated as the current operational deployment.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 20 }}>
              <DeploymentFact label="Archived contract" value={shortHash(PROOF.contract)} href={archivedContractUrl} />
              <DeploymentFact label="Archived evaluator" value={shortHash(PROOF.evaluator)} />
              <DeploymentFact label="Archived payout" value="0.001 BOT" href={explorerTx(677, PROOF.txs.find((tx) => tx.key === "resolve")!.hash)} />
              <DeploymentFact label="Archived final reserve" value="0 / 0 / 0" />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}

function DeploymentFact({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div style={{ minWidth: 0, borderTop: "1px solid var(--color-hairline)", paddingTop: 12 }}>
      <div className="kicker" style={{ fontSize: "0.62rem", color: "var(--color-muted-2)" }}>{label}</div>
      {href ? (
        <a className="mono link-teal" href={href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 6, overflowWrap: "anywhere" }}>
          {value}
        </a>
      ) : (
        <div className="mono" style={{ marginTop: 6, overflowWrap: "anywhere" }}>{value}</div>
      )}
    </div>
  )
}
