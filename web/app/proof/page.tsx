import type { Metadata } from "next"
import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import ProofVerifier from "@/components/ProofVerifier"
import { CURRENT_DEPLOYMENT, PROOF, explorerAddress, explorerTx } from "@/lib/chain"
import { shortHash } from "@/lib/format"

export const metadata: Metadata = {
  title: "Resvyn · Mainnet proof",
  description:
    "Verify Resvyn's current BOT Chain Mainnet deployment and the archived full-lifecycle proof directly against chain 677.",
}

export default function ProofPage() {
  const currentContractUrl = explorerAddress(677, CURRENT_DEPLOYMENT.contract)
  const proofContractUrl = explorerAddress(677, PROOF.contract)

  return (
    <>
      <Nav />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(36px, 5vw, 60px)" }}>
        <header style={{ maxWidth: 860 }}>
          <span className="kicker">Mainnet proof</span>
          <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
            Two deployments, <span className="em">one verifiable story.</span>
          </h1>
          <p className="lead" style={{ marginTop: 16 }}>
            Resvyn’s current hardened contract is live and source-verified on BOT Chain Mainnet. The earlier proof instance is preserved separately
            because it contains a complete disposable warranty lifecycle: reserve funding, coverage, claim, evaluator-authorized payout, and reserve
            reconciliation. The proof verifier below reads that recorded lifecycle directly from chain 677.
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
        </header>

        <section style={{ marginTop: 30 }} aria-labelledby="current-deployment-title">
          <div className="card" style={{ padding: "22px 24px", maxWidth: 900 }}>
            <div style={{ display: "flex", gap: 18, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span className="kicker" style={{ color: "var(--color-teal-ink)" }}>Current deployment</span>
                <h2 id="current-deployment-title" style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 500 }}>
                  Hardened WarrantyReserve
                </h2>
                <p style={{ margin: "8px 0 0", color: "var(--color-muted)", lineHeight: 1.55, maxWidth: 680 }}>
                  Source verified on BOTScan. The public app reads this contract live. A disposable 0.001 BOT smoke reserve is present; writes stay
                  fail-closed until the evaluator manifest and operational flag are deliberately enabled.
                </p>
              </div>
              <Link href="/app" className="btn btn-primary" style={{ flex: "none" }}>
                Inspect live app
              </Link>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 20, minWidth: 0 }}>
              <DeploymentFact
                label="Contract"
                value={shortHash(CURRENT_DEPLOYMENT.contract)}
                href={currentContractUrl}
              />
              <DeploymentFact
                label="Evaluator signer"
                value={shortHash(CURRENT_DEPLOYMENT.evaluator)}
              />
              <DeploymentFact
                label="Deploy block"
                value={CURRENT_DEPLOYMENT.deploymentBlock.toString()}
              />
              <DeploymentFact
                label="Deploy transaction"
                value={shortHash(CURRENT_DEPLOYMENT.deployTx)}
                href={explorerTx(677, CURRENT_DEPLOYMENT.deployTx)}
              />
            </div>
          </div>
        </section>

        <section style={{ marginTop: 42 }} aria-labelledby="recorded-proof-title">
          <span className="kicker">Recorded lifecycle proof</span>
          <h2 id="recorded-proof-title" style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)", fontWeight: 500 }}>
            Archived contract, full lifecycle receipts
          </h2>
          <p style={{ color: "var(--color-muted)", margin: "10px 0 0", maxWidth: 780, lineHeight: 1.55 }}>
            This instance is intentionally read-only. Every state card and receipt below is re-read from BOT Chain Mainnet rather than treated as a
            screenshot or local log.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px", marginTop: 16, fontSize: "0.88rem" }}>
            <Meta label="Network" value="BOT Chain Mainnet" />
            <Meta label="Chain ID" value="677" />
            <div>
              <span style={{ color: "var(--color-muted)" }}>Archived contract </span>
              <a className="mono link-teal" href={proofContractUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem" }}>
                {shortHash(PROOF.contract)}
              </a>
            </div>
            <div>
              <span style={{ color: "var(--color-muted)" }}>Recorded source </span>
              <a className="link-teal" href={`${proofContractUrl}?tab=contract`} target="_blank" rel="noopener noreferrer">
                BOTScan
              </a>
            </div>
          </div>
        </section>

        <ProofVerifier />
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: "var(--color-muted)" }}>{label} </span>
      <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{value}</span>
    </div>
  )
}
