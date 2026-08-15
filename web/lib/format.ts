/**
 * Formatting helpers shared across the app. Pure, no side effects.
 */

const WEI = 10n ** 18n

/** Format a wei bigint (or numeric string) as a trimmed BOT amount string. */
export function formatBOT(value: bigint | string | number): string {
  let wei = typeof value === "bigint" ? value : BigInt(value)
  const neg = wei < 0n
  if (neg) wei = -wei
  const int = wei / WEI
  const frac = (wei % WEI).toString().padStart(18, "0").replace(/0+$/, "")
  return (neg ? "-" : "") + int.toString() + (frac ? "." + frac : "")
}

/** Parse a decimal BOT string into a wei bigint. Throws on malformed input. */
export function parseBOT(input: string): bigint {
  const s = input.trim()
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") {
    throw new Error("Enter a valid BOT amount")
  }
  const [intPart, fracPart = ""] = s.split(".")
  const frac = (fracPart + "0".repeat(18)).slice(0, 18)
  return BigInt(intPart || "0") * WEI + BigInt(frac || "0")
}

/** 0x1234…abcd */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + "…" + addr.slice(-4)
}

/** 0xabcd…1234 for a tx hash (same shape, kept explicit for readability). */
export function shortHash(hash: string): string {
  return shortAddr(hash)
}

export function eqAddr(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}
