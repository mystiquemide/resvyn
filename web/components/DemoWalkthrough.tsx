"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Play,
  Pause,
  RotateCcw,
  ArrowRight,
  Store,
  User,
  Cpu,
  FileCheck2,
  ShieldCheck,
  ShieldAlert,
  Landmark,
} from "lucide-react"
import ReserveMeter from "./ReserveMeter"
import StatusDot from "./StatusDot"
import { formatBOT } from "@/lib/format"

/* Amounts mirror the CP-011 Mainnet proof run, to the wei. Simulated only. */
const DEPOSIT = 5000000000000000n
const LOCK = 1000000000000000n
const PAYOUT = 1000000000000000n
const WITHDRAW = 4000000000000000n

type Tone = "ok" | "idle" | "pending" | "warn" | "fail"
type LogEntry = { actor: string; event: string; detail: string; tone: Tone }
type Sim = {
  balance: bigint
  locked: bigint
  free: bigint
  coverage: boolean
  claim: "none" | "open" | "approved"
  buyerReceived: bigint
  withdrawn: bigint
  log: LogEntry[]
}

const INITIAL: Sim = {
  balance: 0n,
  locked: 0n,
  free: 0n,
  coverage: false,
  claim: "none",
  buyerReceived: 0n,
  withdrawn: 0n,
  log: [],
}

type Step = {
  key: string
  actor: string
  icon: typeof Store
  title: string
  line: string
  guardrail?: boolean
  apply: (s: Sim) => Sim
}

const push = (s: Sim, e: LogEntry): LogEntry[] => [...s.log, e]

const STEPS: Step[] = [
  {
    key: "fund",
    actor: "Merchant",
    icon: Landmark,
    title: "Fund the reserve",
    line: "The merchant deposits 0.005 BOT into their reserve. It sits fully free until any coverage locks against it.",
    apply: (s) => ({
      ...s,
      balance: s.balance + DEPOSIT,
      free: s.free + DEPOSIT,
      log: push(s, { actor: "Merchant", event: "ReserveDeposited", detail: "+0.005 BOT · balance 0.005 · free 0.005", tone: "ok" }),
    }),
  },
  {
    key: "issue",
    actor: "Merchant",
    icon: FileCheck2,
    title: "Issue coverage",
    line: "The merchant issues coverage #1 for a buyer and locks its 0.001 BOT maximum payout against the free reserve.",
    apply: (s) => ({
      ...s,
      locked: s.locked + LOCK,
      free: s.free - LOCK,
      coverage: true,
      log: push(s, { actor: "Merchant", event: "CoverageIssued #1", detail: "locked 0.001 · free 0.004", tone: "ok" }),
    }),
  },
  {
    key: "open",
    actor: "Buyer",
    icon: User,
    title: "Open a claim",
    line: "The buyer opens claim #1 against coverage #1, attaching an evidence hash for what went wrong.",
    apply: (s) => ({
      ...s,
      claim: "open",
      log: push(s, { actor: "Buyer", event: "ClaimOpened #1", detail: "on coverage #1 · evidence hash submitted", tone: "ok" }),
    }),
  },
  {
    key: "evaluate",
    actor: "AI evaluator",
    icon: Cpu,
    title: "AI decision, signed",
    line: "The evaluator reviews the evidence and returns an Approve decision for 0.001 BOT, bound to this exact claim and signed with EIP-712.",
    apply: (s) => ({
      ...s,
      log: push(s, { actor: "AI evaluator", event: "Decision signed", detail: "Approve · 0.001 BOT · EIP-712 signature", tone: "ok" }),
    }),
  },
  {
    key: "resolve",
    actor: "Contract",
    icon: ShieldCheck,
    title: "Verify and pay",
    line: "The contract recovers the signer from the signature, confirms it matches the evaluator key fixed at deployment, and pays 0.001 BOT to the buyer.",
    apply: (s) => ({
      ...s,
      balance: s.balance - PAYOUT,
      locked: s.locked - PAYOUT,
      buyerReceived: s.buyerReceived + PAYOUT,
      claim: "approved",
      log: push(s, { actor: "Contract", event: "ClaimPaid", detail: "0.001 to buyer · balance 0.004 · locked 0", tone: "ok" }),
    }),
  },
  {
    key: "withdraw",
    actor: "Merchant",
    icon: Store,
    title: "Withdraw free reserve",
    line: "With the claim settled, the merchant withdraws the remaining 0.004 BOT free reserve. The reserve reconciles to zero.",
    apply: (s) => ({
      ...s,
      balance: s.balance - WITHDRAW,
      free: s.free - WITHDRAW,
      withdrawn: s.withdrawn + WITHDRAW,
      log: push(s, { actor: "Merchant", event: "ReserveWithdrawn", detail: "0.004 reclaimed · reserve 0 / 0 / 0", tone: "ok" }),
    }),
  },
  {
    key: "replay",
    actor: "Contract",
    icon: ShieldAlert,
    title: "Guardrail: replay blocked",
    guardrail: true,
    line: "Someone replays the same signed decision to try to get paid twice. The contract rejects it because the decision nonce was already spent.",
    apply: (s) => ({
      ...s,
      log: push(s, { actor: "Contract", event: "Rejected · NonceAlreadyUsed", detail: "the signed decision was already spent", tone: "fail" }),
    }),
  },
  {
    key: "overcap",
    actor: "Contract",
    icon: ShieldAlert,
    title: "Guardrail: over-cap blocked",
    guardrail: true,
    line: "The merchant tries to issue new coverage for 0.001 BOT while the free reserve is 0. The contract rejects it, so exposure can never exceed the money behind it.",
    apply: (s) => ({
      ...s,
      log: push(s, { actor: "Contract", event: "Rejected · InsufficientFreeReserve", detail: "free 0 < requested 0.001", tone: "fail" }),
    }),
  },
]

const EVALUATE_INDEX = STEPS.findIndex((s) => s.key === "evaluate")

export default function DemoWalkthrough() {
  const [i, setI] = useState(0) // number of steps already run; STEPS[i] is next
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const state = useMemo(() => STEPS.slice(0, i).reduce((s, step) => step.apply(s), INITIAL), [i])
  const done = i >= STEPS.length
  const active = done ? null : STEPS[i]

  useEffect(() => {
    if (!playing) return
    if (done) {
      setPlaying(false)
      return
    }
    timer.current = setTimeout(() => setI((v) => Math.min(v + 1, STEPS.length)), 1150)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [playing, i, done])

  const runNext = () => setI((v) => Math.min(v + 1, STEPS.length))
  const reset = () => {
    setPlaying(false)
    setI(0)
  }

  return (
    <section className="container-x" style={{ paddingBlock: "clamp(40px, 6vw, 72px)" }}>
      {/* header */}
      <div style={{ maxWidth: 720 }}>
        <span className="kicker">Guided walkthrough</span>
        <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5vw, 3.4rem)", marginTop: 16 }}>
          Watch the whole lifecycle, <span className="em">step by step.</span>
        </h1>
        <p className="lead" style={{ marginTop: 18 }}>
          Fund a reserve, issue coverage, settle a claim through the AI checkpoint, and reclaim what is left.
          Every amount matches the real Mainnet proof run. Nothing here touches a chain.
        </p>
      </div>

      {/* controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
        {!done ? (
          <button className="btn btn-primary" onClick={runNext}>
            {i === 0 ? "Start" : "Run next step"} <ArrowRight size={17} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={reset}>
            Replay <RotateCcw size={16} />
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => setPlaying((p) => !p)}
          disabled={done}
          aria-label={playing ? "Pause autoplay" : "Play all steps"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
          {playing ? "Pause" : "Play all"}
        </button>
        <button className="btn btn-ghost" onClick={reset} disabled={i === 0}>
          Reset
        </button>
        <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--color-muted-2)" }}>
          {done ? "Lifecycle complete" : `Step ${i + 1} of ${STEPS.length}`}
        </span>
      </div>

      {/* two columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
          gap: 28,
          marginTop: 36,
          alignItems: "start",
        }}
        className="demo-grid"
      >
        {/* step rail */}
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {STEPS.map((step, idx) => {
            const isDone = idx < i
            const isActive = idx === i
            const st: "done" | "active" | "next" = isDone ? "done" : isActive ? "active" : "next"
            return <RailItem key={step.key} step={step} state={st} result={isDone ? state.log[idx] : undefined} />
          })}
        </ol>

        {/* live panel */}
        <div style={{ position: "sticky", top: 124, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <span className="kicker">Reserve, simulated</span>
              <span className="pill" style={{ background: "color-mix(in srgb, #c98a1a 12%, #fff)", borderColor: "color-mix(in srgb, #c98a1a 30%, transparent)" }}>
                <StatusDot tone="warn" />
                Simulated
              </span>
            </div>
            <ReserveMeter balanceWei={state.balance} lockedWei={state.locked} freeWei={state.free} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
              <Chip label="Coverage" value={state.coverage ? "Active · #1" : "None"} tone={state.coverage ? "ok" : "idle"} />
              <Chip
                label="Claim"
                value={state.claim === "none" ? "None" : state.claim === "open" ? "Open · #1" : "Approved · paid"}
                tone={state.claim === "approved" ? "ok" : state.claim === "open" ? "pending" : "idle"}
              />
              <Chip label="Buyer received" value={`${formatBOT(state.buyerReceived)} BOT`} tone={state.buyerReceived > 0n ? "ok" : "idle"} />
              <Chip label="Merchant reclaimed" value={`${formatBOT(state.withdrawn)} BOT`} tone={state.withdrawn > 0n ? "ok" : "idle"} />
            </div>
          </div>

          {i > EVALUATE_INDEX && <DecisionCard />}

          <div className="card" style={{ padding: 24 }}>
            <span className="kicker">Event log</span>
            {state.log.length === 0 ? (
              <p style={{ marginTop: 14, fontSize: "0.9rem", color: "var(--color-muted-2)" }}>
                No events yet. Run the first step to fund the reserve.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {state.log.map((e, idx) => (
                  <li key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ marginTop: 5 }}>
                      <StatusDot tone={e.tone} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.9rem", color: e.tone === "fail" ? "var(--color-fail)" : "var(--color-ink)" }}>{e.event}</span>
                        <span style={{ fontSize: "0.72rem", color: "var(--color-muted-2)" }}>{e.actor}</span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--color-muted)", marginTop: 2 }}>{e.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* closing */}
      <div
        style={{
          marginTop: 40,
          padding: "26px 28px",
          borderRadius: 20,
          background: "var(--color-inset)",
          border: "1px solid var(--color-hairline)",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p style={{ margin: 0, maxWidth: 520, color: "var(--color-muted)" }}>
          This walkthrough is simulated. The same lifecycle already ran for real on BOT Chain Mainnet, and you can verify every transaction yourself.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/proof" className="btn btn-primary">
            See the Mainnet proof <ArrowRight size={16} />
          </Link>
          <Link href="/app" className="btn btn-ghost">
            Try it live
          </Link>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .demo-grid { grid-template-columns: 1fr !important; }
          .demo-grid > div { position: static !important; }
        }
      `}</style>
    </section>
  )
}

function RailItem({ step, state, result }: { step: Step; state: "done" | "active" | "next"; result?: LogEntry }) {
  const Icon = step.icon
  const isRejected = state === "done" && step.guardrail
  const circleBg =
    state === "active"
      ? "var(--color-forest)"
      : isRejected
      ? "color-mix(in srgb, var(--color-fail) 12%, #fff)"
      : state === "done"
      ? "color-mix(in srgb, var(--color-teal) 16%, #fff)"
      : "var(--color-inset)"
  const iconColor =
    state === "active" ? "var(--color-canvas)" : isRejected ? "var(--color-fail)" : state === "done" ? "var(--color-teal-ink)" : "var(--color-muted-2)"

  return (
    <li
      className="card"
      style={{
        padding: "16px 18px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        borderColor: state === "active" ? "var(--color-forest)" : "var(--color-hairline)",
        boxShadow: state === "active" ? "0 1px 2px rgba(4,37,25,0.05), 0 16px 34px -20px rgba(4,37,25,0.28)" : undefined,
        opacity: state === "next" ? 0.72 : 1,
        transition: "opacity 0.2s ease, border-color 0.2s ease",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 38,
          height: 38,
          borderRadius: 11,
          background: circleBg,
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon size={18} color={iconColor} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.98rem" }}>{step.title}</span>
          <span
            className="pill"
            style={{ fontSize: "0.68rem", padding: "0.15rem 0.5rem", background: "color-mix(in srgb, var(--color-inset) 55%, #fff)" }}
          >
            {step.actor}
          </span>
        </div>
        {state === "active" && (
          <p style={{ margin: "8px 0 0", fontSize: "0.9rem", lineHeight: 1.5, color: "var(--color-muted)" }}>{step.line}</p>
        )}
        {state === "done" && result && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7 }}>
            <StatusDot tone={result.tone} size={7} />
            <span style={{ fontSize: "0.8rem", color: isRejected ? "var(--color-fail)" : "var(--color-teal-ink)", fontWeight: 500 }}>
              {isRejected ? "Blocked as designed" : result.event}
            </span>
          </div>
        )}
      </div>
    </li>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 13, background: "var(--color-inset)", border: "1px solid var(--color-hairline)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <StatusDot tone={tone} size={7} />
        <span className="kicker" style={{ fontSize: "0.62rem" }}>{label}</span>
      </div>
      <div style={{ marginTop: 5, fontWeight: 600, fontSize: "0.95rem" }}>{value}</div>
    </div>
  )
}

function DecisionCard() {
  const rows: [string, string][] = [
    ["result", "Approve"],
    ["amount", "0.001 BOT"],
    ["claimId", "1"],
    ["coverageId", "1"],
    ["modelVersion", "resvyn-eval-v1"],
    ["nonce", "1"],
    ["signature", "0x9c4e…3f21 (simulated)"],
  ]
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Cpu size={16} color="var(--color-teal-ink)" />
        <span className="kicker">Signed decision</span>
      </div>
      <p style={{ margin: "10px 0 14px", fontSize: "0.85rem", color: "var(--color-muted)" }}>
        What the evaluator hands the contract. The signature is what the contract checks before paying.
      </p>
      <dl
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.82rem",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 7,
          columnGap: 14,
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--color-muted-2)" }}>{k}</dt>
            <dd style={{ margin: 0, textAlign: "right", color: k === "result" ? "var(--color-teal-ink)" : "var(--color-ink)", fontWeight: k === "result" ? 600 : 400 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
