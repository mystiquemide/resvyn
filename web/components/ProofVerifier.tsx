"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { PROOF, explorerTx, explorerAddress } from "@/lib/chain"
import { shortHash } from "@/lib/format"
import {
  readRuntime,
  readReserve,
  readCoverageCount,
  readCoverage,
  readClaimCount,
  readClaim,
  readEvaluator,
  readBalance,
  getChainId,
  checkReceipt,
  checkNegative,
  type CardResult,
  type ReceiptVerdict,
  type Verdict,
} from "@/lib/proofEngine"

/* Live state cards, paired with their reader. Order is the read order. */
const STATE_CARDS: { id: string; label: string; unit?: string; expected: string; read: () => Promise<CardResult>; mono?: boolean }[] = [
  { id: "runtime", label: "Contract runtime", unit: "bytes", expected: "expected 12,756", read: readRuntime },
  { id: "reserve", label: "Merchant reserve · bal / locked / free", expected: "expected 0 / 0 / 0 after reclaim", read: readReserve },
  { id: "covcount", label: "Coverage issued", expected: "expected 1", read: readCoverageCount },
  { id: "cov", label: "Coverage #1 status", expected: "Active, maxPayout 0.001 BOT", read: readCoverage },
  { id: "claimcount", label: "Claims opened", expected: "expected 1", read: readClaimCount },
  { id: "claim", label: "Claim #1 outcome", expected: "Approved, paid 0.001 BOT", read: readClaim },
  { id: "evaluator", label: "Evaluator signer · immutable", expected: "bound at deploy", read: readEvaluator, mono: true },
  { id: "balance", label: "Contract native balance", unit: "BOT", expected: "0, nothing stranded", read: readBalance },
]

const PENDING: CardResult = { value: "…", verdict: "pending", note: "checking" }

type Conn = { state: "idle" | "busy" | "on" | "err"; text: string }

export default function ProofVerifier() {
  const [cards, setCards] = useState<Record<string, CardResult>>(() =>
    Object.fromEntries(STATE_CARDS.map((c) => [c.id, PENDING])),
  )
  const [receipts, setReceipts] = useState<Record<string, ReceiptVerdict>>(() =>
    Object.fromEntries(PROOF.txs.map((t) => [t.key, { verdict: "pending" as Verdict, text: "checking" }])),
  )
  const [neg, setNeg] = useState<ReceiptVerdict>({ verdict: "pending", text: "checking on-chain…" })
  const [conn, setConn] = useState<Conn>({ state: "idle", text: "Connecting to BOT RPC…" })
  const [stamp, setStamp] = useState("")
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const verifyAll = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setConn({ state: "busy", text: "Reading chain 677…" })
    setCards(Object.fromEntries(STATE_CARDS.map((c) => [c.id, PENDING])))
    setReceipts(Object.fromEntries(PROOF.txs.map((t) => [t.key, { verdict: "pending", text: "checking" }])))
    setNeg({ verdict: "pending", text: "checking on-chain…" })

    let chainOk = false
    try {
      chainOk = (await getChainId()) === 677
    } catch {
      /* reflected in connection state below */
    }

    // Fire every state read; fill each card as it settles (progressive), and
    // collect failures for the final connection verdict without aborting.
    const settle = await Promise.allSettled(
      STATE_CARDS.map((c) =>
        c
          .read()
          .then((r) => {
            setCards((prev) => ({ ...prev, [c.id]: r }))
            return r
          })
          .catch((err) => {
            setCards((prev) => ({ ...prev, [c.id]: { value: "-", verdict: "warn", note: "retry" } }))
            throw err
          }),
      ),
    )
    const failed = settle.filter((s) => s.status === "rejected").length

    // Receipts: re-fetch each live; a transport failure marks that row "retry".
    await Promise.allSettled(
      PROOF.txs.map((tx) =>
        checkReceipt(tx)
          .then((v) => setReceipts((prev) => ({ ...prev, [tx.key]: v })))
          .catch(() => setReceipts((prev) => ({ ...prev, [tx.key]: { verdict: "warn", text: "retry" } }))),
      ),
    )

    // Negative proof: only a real on-chain revert flips this green.
    try {
      setNeg(await checkNegative())
    } catch {
      setNeg({ verdict: "warn", text: "retry" })
    }

    const now = new Date()
    setStamp(`Verified ${now.toLocaleTimeString()} · ${now.toLocaleDateString()}`)

    if (chainOk && failed === 0) setConn({ state: "on", text: "Live on BOT Chain Mainnet · chain 677" })
    else if (failed > 0 && failed < STATE_CARDS.length) setConn({ state: "busy", text: "Partial read, some values pending, press Re-verify" })
    else setConn({ state: "err", text: "RPC unreachable, showing recorded proof, press Re-verify" })

    setBusy(false)
    runningRef.current = false
  }, [])

  useEffect(() => {
    // Defer the initial verification so its synchronous setState calls do not
    // run inside the effect body (react-hooks/set-state-in-effect).
    const t = setTimeout(() => verifyAll(), 0)
    return () => clearTimeout(t)
  }, [verifyAll])

  return (
    <>
      {/* live status bar */}
      <div className="proof-bar" role="status" aria-live="polite">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: "0.9rem" }}>
          <ConnDot state={conn.state} />
          {conn.text}
        </span>
        <span style={{ flex: 1 }} />
        {stamp && <span style={{ fontSize: "0.8rem", color: "var(--color-muted-2)" }}>{stamp}</span>}
        <button className="btn btn-primary" onClick={verifyAll} disabled={busy} style={{ padding: "0.5rem 0.95rem", fontSize: "0.86rem" }}>
          <RefreshCw size={15} className={busy ? "spin" : undefined} />
          {busy ? "Verifying…" : "Re-verify live"}
        </button>
      </div>
      <p style={{ fontSize: "0.92rem", color: "var(--color-muted)", margin: "10px 2px 0", maxWidth: "78ch", lineHeight: 1.55 }}>
        Reads go straight to <code className="mono">rpc.botchain.ai</code> over JSON-RPC from your browser. No wallet, no backend, no indexer. If
        the RPC is unreachable the recorded proof below still renders in full. Press Re-verify to retry.
      </p>

      {/* live contract state */}
      <SectionHead kicker="Live contract state" title="Read now from chain 677">
        Each card compares the live read to the value recorded when the proof fired. Badges turn green only when the live chain agrees.
      </SectionHead>
      <div className="proof-grid">
        {STATE_CARDS.map((c) => {
          const r = cards[c.id]
          return (
            <div className="card" key={c.id} style={{ padding: "16px 17px" }}>
              <div className="kicker" style={{ fontSize: "0.62rem" }}>{c.label}</div>
              <div
                className="mono"
                style={{ fontSize: c.mono ? "0.82rem" : "1.15rem", fontWeight: 650, marginTop: 8, wordBreak: "break-all", lineHeight: 1.3 }}
              >
                {r.value}
                {c.unit && r.value !== "…" && r.value !== "-" && (
                  <span style={{ fontWeight: 500, color: "var(--color-muted-2)", fontSize: "0.78rem" }}> {c.unit}</span>
                )}
              </div>
              <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <Badge verdict={r.verdict}>{r.note}</Badge>
                <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>{c.expected}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* timeline */}
      <SectionHead kicker="Proof timeline" title="Six settled transactions">
        The full lifecycle. Each receipt is re-fetched live from chain 677: status, block, and gas are read now, not printed from a log.
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
            {PROOF.txs.map((tx) => {
              const v = receipts[tx.key]
              return (
                <tr key={tx.key}>
                  <td>
                    <div style={{ fontWeight: 650 }}>{tx.step}</div>
                    <div style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>by {tx.who}</div>
                  </td>
                  <td className="num">{tx.value || <span style={{ color: "var(--color-muted-2)" }}>-</span>}</td>
                  <td>{tx.event ? <code className="mono">{tx.event}</code> : <span style={{ color: "var(--color-muted-2)" }}>-</span>}</td>
                  <td className="num">{tx.block.toString()}</td>
                  <td className="num">{tx.gas.toLocaleString()}</td>
                  <td>
                    <Badge verdict={v.verdict} title={v.title}>{v.text}</Badge>
                  </td>
                  <td>
                    <a className="mono link-teal" style={{ fontSize: "0.78rem" }} href={explorerTx(677, tx.hash)} target="_blank" rel="noopener noreferrer">
                      {shortHash(tx.hash)}
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.92rem", color: "var(--color-muted)", margin: "12px 2px 0", maxWidth: "80ch", lineHeight: 1.55 }}>
        Each row links to BOTScan. The live-receipt badge is set from a direct <code className="mono">eth_getTransactionReceipt</code> call in your
        browser and turns green only when the chain returns status success with the expected block, gas, and event.
      </p>

      {/* AI decision + negatives */}
      <SectionHead kicker="AI decision and negative proofs" title="The settlement, and the two attacks it rejects" />
      <div className="proof-cols">
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontFamily: "var(--font-display)", fontWeight: 500 }}>Bounded AI decision</h3>
          <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
            brain to strict schema gate to contract-bound EIP-712 signature, verified on-chain by <code className="mono">resolveClaim</code>
          </p>
          <dl className="proof-kv">
            <dt>Decision</dt>
            <dd style={{ color: "var(--color-teal-ink)", fontWeight: 600 }}>APPROVE</dd>
            <dt>Reason</dt>
            <dd>ELIGIBLE_DAMAGE_VERIFIED</dd>
            <dt>Amount</dt>
            <dd>0.001 BOT</dd>
            <dt>Signer</dt>
            <dd>{shortHash(PROOF.evaluator)}</dd>
            <dt>Bound to</dt>
            <dd>claim 1 · coverage 1 · chain 677</dd>
            <dt>On-chain result</dt>
            <dd>ClaimPaid, nonce burned</dd>
          </dl>
          <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", marginTop: 14, marginBottom: 0, lineHeight: 1.55 }}>
            The signer is immutable, bound once at deploy with no setter. Only its signature settles a claim, and the decision is bound to the exact
            claim, coverage, claimant, evidence hash, amount, and chain. A decision for one claim cannot be replayed onto another.
          </p>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontFamily: "var(--font-display)", fontWeight: 500 }}>Negative proofs</h3>
          <p style={{ fontSize: "0.9rem", color: "var(--color-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
            Both enforced at the contract level as call-level rejections. No transaction, no state change, no balance moved.
          </p>
          <Reject err="NonceAlreadyUsed">
            Replaying the exact signed decision that already settled claim #1 reverts. One decision can pay once. The settlement nonce is burned and
            terminal.
          </Reject>
          <Reject err="InsufficientFreeReserve">
            Issuing coverage for one wei more than the free reserve reverts. This is the invariant itself, enforced to the wei.
          </Reject>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 9 }}>
            <Badge verdict={neg.verdict} title={neg.title}>{neg.text}</Badge>
            <span style={{ fontSize: "0.84rem", color: "var(--color-muted)" }}>re-checked now via eth_call, changes nothing</span>
          </div>
        </div>
      </div>

      <ProofStyles />
    </>
  )
}

/* ---- presentational bits ------------------------------------------------ */

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 44, marginBottom: 16 }}>
      <span className="kicker" style={{ color: "var(--color-muted)" }}>{kicker}</span>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(1.55rem, 3.2vw, 2.05rem)", margin: "8px 0 0", letterSpacing: "-0.01em", color: "var(--color-ink)" }}>
        {title}
      </h2>
      {children && <p style={{ color: "var(--color-muted)", margin: "10px 0 0", maxWidth: "76ch", fontSize: "1rem", lineHeight: 1.55 }}>{children}</p>}
    </div>
  )
}

function Badge({ verdict, children, title }: { verdict: Verdict; children: React.ReactNode; title?: string }) {
  const c =
    verdict === "ok"
      ? { fg: "var(--color-teal-ink)", bg: "color-mix(in srgb, var(--color-teal) 15%, #fff)", bd: "color-mix(in srgb, var(--color-teal) 34%, transparent)" }
      : verdict === "bad"
      ? { fg: "var(--color-fail)", bg: "color-mix(in srgb, var(--color-fail) 10%, #fff)", bd: "color-mix(in srgb, var(--color-fail) 30%, transparent)" }
      : verdict === "warn"
      ? { fg: "#9a6612", bg: "color-mix(in srgb, #c98a1a 13%, #fff)", bd: "color-mix(in srgb, #c98a1a 32%, transparent)" }
      : { fg: "var(--color-muted-2)", bg: "var(--color-inset)", bd: "var(--color-hairline)" }
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "0.78rem",
        fontWeight: 700,
        letterSpacing: "0.01em",
        padding: "0.2rem 0.55rem",
        borderRadius: 999,
        color: c.fg,
        background: c.bg,
        border: `1px solid ${c.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        className={verdict === "pending" ? "proof-dot-pulse" : undefined}
        style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flex: "none" }}
      />
      {children}
    </span>
  )
}

function ConnDot({ state }: { state: Conn["state"] }) {
  const color = state === "on" ? "var(--color-teal)" : state === "err" ? "var(--color-fail)" : state === "busy" ? "#c98a1a" : "var(--color-muted-2)"
  const glow =
    state === "on"
      ? "0 0 0 4px color-mix(in srgb, var(--color-teal) 18%, transparent)"
      : state === "err"
      ? "0 0 0 4px color-mix(in srgb, var(--color-fail) 16%, transparent)"
      : state === "busy"
      ? "0 0 0 4px color-mix(in srgb, #c98a1a 16%, transparent)"
      : "none"
  return (
    <span
      className={state === "busy" ? "proof-dot-pulse" : undefined}
      style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: glow, flex: "none" }}
    />
  )
}

function Reject({ err, children }: { err: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11, padding: "11px 0", borderTop: "1px solid var(--color-hairline)" }}>
      <span className="mono" style={{ color: "var(--color-fail)", fontSize: "0.86rem", fontWeight: 700, flex: "none" }}>
        {err}
      </span>
      <span style={{ fontSize: "0.9rem", color: "var(--color-muted)", lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function ProofStyles() {
  return (
    <style>{`
      .proof-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:26px;
        padding:13px 16px; background:#fff; border:1px solid var(--color-hairline); border-radius:13px;
        box-shadow:0 1px 2px rgba(4,37,25,0.04); }
      .proof-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(248px, 1fr)); gap:14px; }
      .proof-cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      .proof-tablewrap { overflow-x:auto; border:1px solid var(--color-hairline); border-radius:14px; background:#fff; }
      .proof-table { border-collapse:collapse; width:100%; min-width:720px; font-size:0.94rem; }
      .proof-table thead th { text-align:left; font-size:0.74rem; text-transform:uppercase; letter-spacing:0.06em;
        color:var(--color-muted); font-weight:700; padding:13px 14px; border-bottom:1px solid var(--color-hairline);
        background:var(--color-inset); }
      .proof-table thead th.num, .proof-table td.num { text-align:left; }
      .proof-table tbody td { padding:12px 14px; border-bottom:1px solid var(--color-hairline); vertical-align:top; }
      .proof-table tbody tr:last-child td { border-bottom:0; }
      .proof-table td.num { font-family:var(--font-mono, ui-monospace, monospace); white-space:nowrap; }
      .proof-kv { display:grid; grid-template-columns:auto 1fr; gap:8px 16px; font-size:0.92rem; margin:0; }
      .proof-kv dt { color:var(--color-muted); }
      .proof-kv dd { margin:0; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; text-align:right; }
      .proof-cmd { background:var(--color-forest); color:#d7f5ec; border-radius:12px; padding:16px 18px;
        overflow-x:auto; font-size:0.8rem; line-height:1.6; margin:0; }
      .mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      code.mono { background:var(--color-inset); padding:0.05rem 0.35rem; border-radius:6px; font-size:0.85em; }
      .spin { animation:proof-spin 0.9s linear infinite; }
      @keyframes proof-spin { to { transform:rotate(360deg); } }
      .proof-dot-pulse { animation:proof-pulse 1.1s ease-in-out infinite; }
      @keyframes proof-pulse { 50% { opacity:0.35; } }
      @media (max-width:820px) { .proof-cols { grid-template-columns:1fr; } }
      @media (prefers-reduced-motion:reduce) { .spin, .proof-dot-pulse { animation:none; } }
    `}</style>
  )
}
