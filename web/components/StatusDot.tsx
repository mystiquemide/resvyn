type Tone = "ok" | "idle" | "pending" | "warn" | "fail"

const COLORS: Record<Tone, string> = {
  ok: "var(--color-teal)",
  idle: "var(--color-muted-2)",
  pending: "var(--color-teal)",
  warn: "#c98a1a",
  fail: "var(--color-fail)",
}

export default function StatusDot({
  tone = "idle",
  size = 8,
}: {
  tone?: Tone
  size?: number
}) {
  const color = COLORS[tone]
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "999px",
        background: color,
        boxShadow: tone === "pending" ? `0 0 0 0 ${color}` : "none",
        animation: tone === "pending" ? "resvyn-pulse 1.6s ease-out infinite" : "none",
        flex: "none",
      }}
    />
  )
}
