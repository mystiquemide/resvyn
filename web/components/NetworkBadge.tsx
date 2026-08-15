import StatusDot from "./StatusDot"

type Tone = "ok" | "idle" | "pending" | "warn" | "fail"

export default function NetworkBadge({
  label = "BOT Chain Mainnet",
  sub,
  tone = "ok",
}: {
  label?: string
  sub?: string
  tone?: Tone
}) {
  return (
    <span className="pill" style={{ background: "color-mix(in srgb, var(--color-inset) 50%, #fff)" }}>
      <StatusDot tone={tone} />
      <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{label}</span>
      {sub && <span style={{ color: "var(--color-muted-2)" }}>{sub}</span>}
    </span>
  )
}
