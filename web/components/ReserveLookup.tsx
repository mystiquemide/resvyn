"use client"

import { useState } from "react"
import { createPublicClient, http, isAddress, type Address } from "viem"
import { APP_CHAIN, APP_CONTRACT_ADDRESS, explorerAddress, warrantyReserveAbi } from "@/lib/chain"
import { shortAddr } from "@/lib/format"
import { PROOF } from "@/lib/chain"
import ReserveMeter from "./ReserveMeter"
import StatusDot from "./StatusDot"

const client = createPublicClient({ chain: APP_CHAIN, transport: http() })

// A demo wallet that does not exist on chain. Shown as the input placeholder
// only: display text, never a value, never clickable.
const DEMO_WALLET_PLACEHOLDER = "0x1234…7890"

type Result = {
  merchant: Address
  balance: bigint
  locked: bigint
  free: bigint
  coverageCount: bigint
}

export default function ReserveLookup() {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function lookup(raw: string) {
    const addr = raw.trim()
    if (!isAddress(addr)) {
      setResult(null)
      setError("That doesn't look like a wallet address. Paste a full 0x address, or tap 'Use the proof merchant'.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const [reserve, coverageCount] = await Promise.all([
        client.readContract({
          address: APP_CONTRACT_ADDRESS,
          abi: warrantyReserveAbi,
          functionName: "reserveOf",
          args: [addr],
        }),
        client.readContract({
          address: APP_CONTRACT_ADDRESS,
          abi: warrantyReserveAbi,
          functionName: "coverageCount",
        }),
      ])
      const [balance, locked, free] = reserve
      setResult({ merchant: addr, balance, locked, free, coverageCount })
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : "Could not reach BOT Chain Mainnet. Check your connection and tap Check reserve again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <header style={{ maxWidth: 720 }}>
        <span className="kicker">Live lookup</span>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 14 }}>
          Look up a <span className="em">reserve.</span>
        </h1>
        <p className="lead" style={{ marginTop: 16 }}>
          Paste a merchant address for Resvyn to read.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void lookup(input)
        }}
        style={{ marginTop: 28, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={DEMO_WALLET_PLACEHOLDER}
          spellCheck={false}
          aria-label="Merchant address"
          style={{
            flex: "1 1 280px",
            border: "1px solid var(--color-hairline)",
            borderRadius: 12,
            padding: "12px 14px",
            background: "#fff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.92rem",
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Check reserve"}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            setInput(PROOF.merchant)
            void lookup(PROOF.merchant)
          }}
        >
          Use the proof merchant
        </button>
      </form>

      {error && (
        <p style={{ marginTop: 16, color: "var(--color-fail)", fontSize: "0.92rem" }}>{error}</p>
      )}

      {result && (
        <div className="card" style={{ marginTop: 28, padding: 24, maxWidth: 640 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
            <span className="kicker">Reserve, live</span>
            <a className="link-teal" href={explorerAddress(677, result.merchant)} target="_blank" rel="noopener noreferrer">
              {shortAddr(result.merchant)} on BOTScan
            </a>
          </div>
          <ReserveMeter
            balanceWei={result.balance}
            lockedWei={result.locked}
            freeWei={result.free}
            caption={`Read from reserveOf on BOT Chain Mainnet. Contract coverages issued: ${result.coverageCount.toString()}.`}
          />
          {result.balance === 0n && result.locked === 0n && (
            <p style={{ marginTop: 16, fontSize: "0.9rem", color: "var(--color-muted)" }}>
              No reserve funded at this address yet. The recorded proof merchant finished at 0 / 0 / 0 after reclaim.
            </p>
          )}
        </div>
      )}

      {!result && !error && (
        <p style={{ marginTop: 22, fontSize: "0.9rem", color: "var(--color-muted)", display: "flex", gap: 8, alignItems: "center" }}>
          <StatusDot tone="idle" />
          Enter an address to read the live reserve. Paste any merchant address, or tap &apos;Use the proof merchant&apos;.
        </p>
      )}
    </section>
  )
}
