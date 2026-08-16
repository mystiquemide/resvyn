"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { CURRENT_PROOF } from "@/lib/currentProof"
import { explorerTx } from "@/lib/chain"
import { shortHash } from "@/lib/format"
import {
  checkOverCap,
  checkReceipt,
  getChainId,
  readClaim,
  readClaimCount,
  readContractBalance,
  readCoverage,
  readCoverageCount,
  readEvaluator,
  readEvidenceStatus,
  readMerchantReserve,
  readNonce,
  readRuntime,
  type CardResult,
  type ReceiptVerdict,
  type Verdict,
} from "@/lib/currentProofEngine"

const STATE_CARDS: { id: string; label: string; expected: string; read: () => Promise<CardResult>; mono?: boolean }[] = [
  { id: "runtime", label: "Current contract runtime", expected: "live bytecode on chain 677", read: readRuntime },
  { id: "reserve", label: "Fresh merchant reserve · bal / locked / free", expected: "0 / 0 / 0 after payout + reclaim", read: readMerchantReserve },
  { id: "covcount", label: "Coverage count", expected: "coverage #1 exists", read: readCoverageCount },
  { id: "coverage", label: "Coverage #1", expected: "buyer-bound · max 0.0005 BOT", read: readCoverage },
  { id: "claimcount", label: "Claim count", expected: "claim #1 exists", read: readClaimCount },
  { id: "claim", label: "Claim #1", expected: "Approved · paid 0.0005 BOT", read: readClaim },
  { id: "evaluator", label: "Immutable evaluator", expected: "matches production signer", read: readEvaluator, mono: true },
  { id: "nonce", label: "Replay protection", expected: "nonce 1 consumed", read: readNonce },
  { id: "evidence", label: "Durable evidence", expected: "VPS record matches on-chain hash", read: readEvidenceStatus },
  { id: "balance", label: "Contract native balance", expected: "includes separate 0.001 BOT smoke reserve", read: readContractBalance },
]

const PENDING: CardResult = { value: "…", verdict: "pending", note: "checking" }
type Conn = { state: "idle" | "busy" | "on" | "err"; text: string }

export default function CurrentProofVerifier() {
  const [cards, setCards] = useState<Record<string, CardResult>>(() => Object.fromEntries(STATE_CARDS.map((c) => [c.id, PENDING])))
  const [receipts, setReceipts] = useState<Record<string, ReceiptVerdict>>(() => Object.fromEntries(CURRENT_PROOF.txs.map((t) => [t.key, { verdict: "pending" as Verdict, text: "checking" }])))
  const [overCap, setOverCap] = useState<ReceiptVerdict>({ verdict: "pending", text: "checking" })
  const [conn, setConn] = useState<Conn>({ state: "idle", text: "Connecting to BOT Chain Mainnet…" })
  const [stamp, setStamp] = useState("")
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const verifyAll = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setConn({ state: "busy", text: "Reading current deployment on chain 677…" })
    setCards(Object.fromEntries(STATE_CARDS.map((c) => [c.id, PENDING])))
    setReceipts(Object.fromEntries(CURRENT_PROOF.txs.map((t) => [t.key, { verdict: "pending" as Verdict, text: "checking" }])))
    setOverCap({ verdict: "pending", text: "checking" })

    let chainOk = false
    try {
      chainOk = (await getChainId()) === CURRENT_PROOF.chainId
    } catch {
      // reflected in the final connection state
    }

    const stateResults = await Promise.allSettled(
      STATE_CARDS.map((card) =>
        card.read().then((result) => {
          setCards((prev) => ({ ...prev, [card.id]: result }))
          return result
        }).catch((err) => {
          setCards((prev) => ({ ...prev, [card.id]: { value: "-", verdict: "warn", note: "retry" } }))
          throw err
        }),
      ),
    )

    await Promise.allSettled(
      CURRENT_PROOF.txs.map((tx) =>
        checkReceipt(tx)
          .then((result) => setReceipts((prev) => ({ ...prev, [tx.key]: result })))
          .catch(() => setReceipts((prev) => ({ ...prev, [tx.key]: { verdict: "warn", text: "retry" } }))),
      ),
    )

    try {
      setOverCap(await checkOverCap())
    } catch {
      setOverCap({ verdict: "warn", text: "retry" })
    }

    const failed = stateResults.filter((result) => result.status === "rejected").length
    const now = new Date()
    setStamp(`Verified ${now.toLocaleTimeString()} · ${now.toLocaleDateString()}`)
    if (chainOk && failed === 0) setConn({ state: "on", text: "Current lifecycle verified live on BOT Chain Mainnet" })
    else if (failed < STATE_CARDS.length) setConn({ state: "busy", text: "Partial read · press Re-verify" })
    else setConn({ state: "err", text: "Live verification unavailable · recorded receipts remain linked below" })

    setBusy(false)
    runningRef.current = false
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => verifyAll(), 0)
    return () => clearTimeout(timer)
  }, [verifyAll])

  return (
    <>
      <div className="proof-bar" role="status" aria-live="polite" style={{ marginTop: 28 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: "0.9rem" }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: conn.state === "on" ? "var(--color-teal)" : conn.state === "err" ? "#b45309" : "var(--color-muted-2)" }} />
          {conn.text}
        </span>
        <span style={{ flex: 1 }} />
        {stamp && <span style={{ fontSize: "0.8rem", color: "var(--color-muted-2)" }}>{stamp}</span>}
        <button className="btn btn-primary" onClick={verifyAll} disabled={busy} style={{ padding: "0.5rem 0.95rem", fontSize: "0.86rem" }}>
          <RefreshCw size={15} /> {busy ? "Verifying…" : "Re-verify live"}
        </button>
      </div>

      <p style={{ fontSize: "0.92rem", color: "var(--color-muted)", margin: "10px 2px 0", maxWidth: "80ch", lineHeight: 1.55 }}>
        Chain state and receipts are read directly from <code className="mono">rpc.botchain.ai</code>. The evidence card separately checks the production VPS evidence API. No wallet is required to verify this page.
      </p>

      <SectionHead kicker="Current lifecycle state" title="The hardened deployment completed the full loop">
        Fresh merchant, separate buyer, buyer-bound coverage, durable evidence, evaluator-authorized payout, replay protection, and final merchant reserve reconciliation.
      </SectionHead>
      <div className="proof-grid">
        {STATE_CARDS.map((card) => {
          const result = cards[card.id]
          return (
            <div className="card" key={card.id} style={{ padding: "16px 17px" }}>
              <div className="kicker" style={{ fontSize: "0.62rem" }}>{card.label}</div>
              <div className="mono" style={{ fontSize: card.mono ? "0.82rem" : "1.05rem", fontWeight: 650, marginTop: 8, overflowWrap: "anywhere", lineHeight: 1.35 }}>
                {result.value}
              </div>
              <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <Badge verdict={result.verdict}>{result.note}</Badge>
                <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>{card.expected}</span>
              </div>
            </div>
          )
        })}
      </div>

      <SectionHead kicker="Mainnet receipts" title="Five transactions, one production lifecycle">
        Every transaction is re-fetched from chain 677 and reconciled against its recorded block, gas used, contract event, and successful status.
      </SectionHead>
      <div className="proof-tablewrap">
        <table className="proof-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Value</th>
              <th>Event</th>
              <th className="num">Block</th>
              <th className="num">Gas</th>
              <th>Live receipt</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {CURRENT_PROOF.txs.map((tx) => {
              const receipt = receipts[tx.key]
              return (
                <tr key={tx.key}>
                  <td><div style={{ fontWeight: 650 }}>{tx.step}</div><div style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>by {tx.who}</div></td>
                  <td>{tx.value}</td>
                  <td><code className="mono">{tx.event}</code></td>
                  <td className="num">{tx.block.toString()}</td>
                  <td className="num">{tx.gas.toLocaleString()}</td>
                  <td><Badge verdict={receipt.verdict} title={receipt.title}>{receipt.text}</Badge></td>
                  <td><a className="mono link-teal" style={{ fontSize: "0.78rem" }} href={explorerTx(677, tx.hash)} target="_blank" rel="noopener noreferrer">{shortHash(tx.hash)}</a></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <SectionHead kicker="Settlement proof" title="Bounded evaluator, real payout, terminal nonce" />
      <div className="proof-cols">
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontFamily: "var(--font-display)", fontWeight: 500 }}>Evaluator-authorized settlement</h3>
          <dl className="proof-kv" style={{ marginTop: 14 }}>
            <dt>Decision</dt><dd style={{ color: "var(--color-teal-ink)", fontWeight: 600 }}>APPROVE</dd>
            <dt>Paid</dt><dd>0.0005 BOT</dd>
            <dt>Buyer</dt><dd className="mono">{shortHash(CURRENT_PROOF.buyer)}</dd>
            <dt>Evidence</dt><dd className="mono">{shortHash(CURRENT_PROOF.evidenceHash)}</dd>
            <dt>Model version</dt><dd style={{ overflowWrap: "anywhere" }}>{CURRENT_PROOF.modelVersion}</dd>
            <dt>Signer</dt><dd className="mono">{shortHash(CURRENT_PROOF.evaluator)}</dd>
            <dt>Nonce</dt><dd>{CURRENT_PROOF.nonce.toString()} · consumed</dd>
          </dl>
          <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", marginTop: 14, marginBottom: 0, lineHeight: 1.55 }}>
            The evaluator signature recovered to the immutable signer fixed in the current contract. The decision was bound to chain 677, this verifier, coverage #1, claim #1, the buyer, the committed evidence hash, amount, expiry, and nonce.
          </p>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontFamily: "var(--font-display)", fontWeight: 500 }}>Negative proofs</h3>
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <div><code className="mono">NonceAlreadyUsed</code><p style={{ margin: "5px 0 0", color: "var(--color-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>The lifecycle replay simulation rejected the already-settled decision. The live verifier independently confirms nonce 1 is consumed.</p></div>
            <div><code className="mono">InsufficientFreeReserve</code><p style={{ margin: "5px 0 0", color: "var(--color-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>An over-cap issuance simulation is re-run below with <code className="mono">eth_call</code>. It changes no state and moves no funds.</p></div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><Badge verdict={overCap.verdict} title={overCap.title}>{overCap.text}</Badge><span style={{ color: "var(--color-muted)", fontSize: "0.84rem" }}>over-cap check live</span></div>
          </div>
        </div>
      </div>

      <SectionHead kicker="Reserve accounting" title="The fresh merchant exposure reconciled to zero" />
      <div className="proof-grid">
        <Snapshot label="After deposit" value={CURRENT_PROOF.reserveSnapshots.afterDeposit} />
        <Snapshot label="After issuance" value={CURRENT_PROOF.reserveSnapshots.afterIssue} />
        <Snapshot label="After settlement" value={CURRENT_PROOF.reserveSnapshots.afterSettlement} />
        <Snapshot label="After withdrawal" value={CURRENT_PROOF.reserveSnapshots.afterWithdrawal} />
      </div>
      <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", marginTop: 14, lineHeight: 1.55, maxWidth: "82ch" }}>
        The contract itself still holds the separate 0.001 BOT smoke reserve deposited earlier by another merchant. That balance is intentionally not presented as part of this fresh merchant lifecycle.
      </p>
    </>
  )
}

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return <div style={{ marginTop: 44, marginBottom: 16 }}><span className="kicker" style={{ color: "var(--color-muted)" }}>{kicker}</span><h2 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)", margin: "8px 0 0", color: "var(--color-ink)" }}>{title}</h2>{children && <p style={{ color: "var(--color-muted)", margin: "10px 0 0", maxWidth: "78ch", fontSize: "1rem", lineHeight: 1.55 }}>{children}</p>}</div>
}

function Snapshot({ label, value }: { label: string; value: string }) {
  return <div className="card" style={{ padding: "16px 17px" }}><div className="kicker" style={{ fontSize: "0.62rem" }}>{label}</div><div className="mono" style={{ marginTop: 8, fontSize: "1.05rem", fontWeight: 650 }}>{value}</div><div style={{ marginTop: 8, color: "var(--color-muted)", fontSize: "0.82rem" }}>balance / locked / free · BOT</div></div>
}

function Badge({ verdict, children, title }: { verdict: Verdict; children: React.ReactNode; title?: string }) {
  const style = verdict === "ok" ? { color: "var(--color-teal-ink)", borderColor: "color-mix(in srgb, var(--color-teal) 38%, transparent)" } : verdict === "bad" ? { color: "#991b1b", borderColor: "#fecaca" } : { color: "var(--color-muted)", borderColor: "var(--color-hairline)" }
  return <span title={title} style={{ display: "inline-flex", alignItems: "center", border: "1px solid", borderRadius: 999, padding: "3px 8px", fontSize: "0.74rem", fontWeight: 650, ...style }}>{children}</span>
}
