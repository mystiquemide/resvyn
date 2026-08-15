import { formatBOT } from "@/lib/format"

/**
 * The reserve, made visible. A single stacked bar: locked exposure (forest)
 * sits inside the funded balance, and the remaining free reserve (teal) is
 * what a merchant can still issue against or withdraw.
 *
 * Presentational only. Landing passes the recorded Mainnet numbers; /app
 * passes live on-chain reads. Same component, no fake data either way.
 */
export default function ReserveMeter({
  balanceWei,
  lockedWei,
  freeWei,
  caption,
}: {
  balanceWei: bigint
  lockedWei: bigint
  freeWei: bigint
  caption?: string
}) {
  const total = balanceWei > 0n ? balanceWei : 0n
  const lockedPct = total > 0n ? Number((lockedWei * 10000n) / total) / 100 : 0
  const freePct = total > 0n ? Number((freeWei * 10000n) / total) / 100 : 0
  const empty = total === 0n

  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 18,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--color-inset)",
          border: "1px solid var(--color-hairline)",
        }}
      >
        {!empty && (
          <>
            <div
              title={`Locked ${formatBOT(lockedWei)} BOT`}
              style={{
                width: `${lockedPct}%`,
                background: "var(--color-forest)",
                transformOrigin: "left",
                animation: "resvyn-grow 0.7s ease-out",
              }}
            />
            <div
              title={`Free ${formatBOT(freeWei)} BOT`}
              style={{
                width: `${freePct}%`,
                background: "var(--color-teal)",
                transformOrigin: "left",
                animation: "resvyn-grow 0.9s ease-out",
              }}
            />
          </>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginTop: 16,
        }}
      >
        <Stat label="Balance" value={formatBOT(balanceWei)} swatch="var(--color-hairline)" />
        <Stat label="Locked" value={formatBOT(lockedWei)} swatch="var(--color-forest)" />
        <Stat label="Free" value={formatBOT(freeWei)} swatch="var(--color-teal)" />
      </div>

      {empty && (
        <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--color-muted-2)" }}>
          No reserve funded yet.
        </p>
      )}
      {caption && (
        <p style={{ marginTop: 14, fontSize: "0.85rem", color: "var(--color-muted-2)" }}>{caption}</p>
      )}
    </div>
  )
}

function Stat({ label, value, swatch }: { label: string; value: string; swatch: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: 3, background: swatch, flex: "none" }}
        />
        <span className="kicker" style={{ fontSize: "0.66rem" }}>
          {label}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.35rem",
          marginTop: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
        <span style={{ fontSize: "0.8rem", color: "var(--color-muted-2)", marginLeft: 4 }}>BOT</span>
      </div>
    </div>
  )
}
