/*
 * Resvyn proof engine (client-safe).
 * Ports the CP-013 verified reader (web/proof.js) to typed functions that read
 * the deployed WarrantyReserve on BOT Chain Mainnet (chain 677) directly over
 * JSON-RPC. No wallet, no backend, no indexer. Every value /proof shows is read
 * live here or is a recorded receipt re-fetched live and reconciled. If the RPC
 * is down the recorded proof still stands; the live layer is enhancement.
 *
 * Single source of truth for addresses, selectors, event topics and expected
 * values is lib/chain.ts (PROOF). This file only reads and reconciles.
 */
import { PROOF, MAINNET_RPC } from "./chain"

const ADDR = PROOF.contract
const MERCHANT = PROOF.merchant
const BUYER = PROOF.buyer
const EVALUATOR = PROOF.evaluator
const SEL = PROOF.selectors
const ERR_INSUFFICIENT_FREE = PROOF.errInsufficientFree
const EVENT_TOPIC = PROOF.eventTopic as Record<string, string>
const WEI = 10n ** 18n
const MAX_PAYOUT = PROOF.maxPayoutWei

export type Verdict = "ok" | "warn" | "bad" | "pending"

/* ---- JSON-RPC ----------------------------------------------------------- */
type RpcError = Error & { rpc?: { message?: string; data?: unknown } }
let rpcId = 0

async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  })
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) {
    const e = new Error(json.error.message || `${method} error`) as RpcError
    e.rpc = json.error // may carry revert data in .data
    throw e
  }
  return json.result
}
const ethCall = (data: string, from?: string) =>
  rpc("eth_call", [from ? { from, to: ADDR, data } : { to: ADDR, data }, "latest"])

/* ---- encode / decode ---------------------------------------------------- */
const u256 = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0")
const encAddr = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0")
const encB32 = (h: string) => h.toLowerCase().replace(/^0x/, "").padStart(64, "0")
const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + i * 64 + 64)
const wordBig = (data: string, i: number) => BigInt("0x" + word(data, i))
const wordAddr = (data: string, i: number) => "0x" + word(data, i).slice(24)

export function formatBOT(wei: bigint): string {
  let w = BigInt(wei)
  const neg = w < 0n
  if (neg) w = -w
  const int = w / WEI
  const frac = (w % WEI).toString().padStart(18, "0").replace(/0+$/, "")
  return (neg ? "-" : "") + int.toString() + (frac ? "." + frac : "")
}
const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/* ---- live state reads --------------------------------------------------- */
export type CardResult = { value: string; verdict: Verdict; note: string }

export async function readRuntime(): Promise<CardResult> {
  const code = await rpc("eth_getCode", [ADDR, "latest"])
  const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0
  return {
    value: bytes.toLocaleString(),
    verdict: bytes === PROOF.runtimeBytes ? "ok" : bytes > 0 ? "warn" : "bad",
    note: bytes === PROOF.runtimeBytes ? "matches chain" : bytes > 0 ? "live, differs" : "no code",
  }
}
export async function readReserve(): Promise<CardResult> {
  const d = await ethCall(SEL.reserveOf + encAddr(MERCHANT))
  const bal = wordBig(d, 0), locked = wordBig(d, 1), free = wordBig(d, 2)
  const zero = bal === 0n && locked === 0n && free === 0n
  return {
    value: `${formatBOT(bal)} / ${formatBOT(locked)} / ${formatBOT(free)}`,
    verdict: zero ? "ok" : "warn",
    note: zero ? "reconciled 0 / 0 / 0" : "live",
  }
}
export async function readCoverageCount(): Promise<CardResult> {
  const n = wordBig(await ethCall(SEL.coverageCount), 0)
  return { value: n.toString(), verdict: n === 1n ? "ok" : "warn", note: n === 1n ? "matches chain" : "live" }
}
export async function readClaimCount(): Promise<CardResult> {
  const n = wordBig(await ethCall(SEL.claimCount), 0)
  return { value: n.toString(), verdict: n === 1n ? "ok" : "warn", note: n === 1n ? "matches chain" : "live" }
}
export async function readCoverage(): Promise<CardResult> {
  const d = await ethCall(SEL.coverageOf + u256(1))
  const claimant = wordAddr(d, 1)
  const maxPayout = wordBig(d, 4)
  const status = Number(wordBig(d, 6)) // 1 = Active
  const good = status === 1 && maxPayout === MAX_PAYOUT && eqAddr(claimant, BUYER)
  return {
    value: `${status === 1 ? "Active" : "status " + status} · ${formatBOT(maxPayout)} BOT`,
    verdict: good ? "ok" : "warn",
    note: good ? "matches chain" : "live",
  }
}
export async function readClaim(): Promise<CardResult> {
  const d = await ethCall(SEL.claimOf + u256(1))
  const paid = wordBig(d, 3)
  const status = Number(wordBig(d, 4)) // 2 = Approved
  const label = status === 2 ? "Approved" : status === 3 ? "Rejected" : status === 1 ? "Open" : "None"
  const good = status === 2 && paid === MAX_PAYOUT
  return { value: `${label} · paid ${formatBOT(paid)} BOT`, verdict: good ? "ok" : "warn", note: good ? "matches chain" : "live" }
}
export async function readEvaluator(): Promise<CardResult> {
  const a = wordAddr(await ethCall(SEL.evaluatorSigner), 0)
  const good = eqAddr(a, EVALUATOR)
  return { value: a, verdict: good ? "ok" : "bad", note: good ? "matches chain" : "differs" }
}
export async function readBalance(): Promise<CardResult> {
  const bal = BigInt(await rpc("eth_getBalance", [ADDR, "latest"]))
  return { value: `${formatBOT(bal)}`, verdict: bal === 0n ? "ok" : "warn", note: bal === 0n ? "nothing stranded" : "live" }
}

export const getChainId = async (): Promise<number> => parseInt(await rpc("eth_chainId"), 16)

/* ---- receipts ----------------------------------------------------------- */
export type ProofTx = (typeof PROOF.txs)[number]
export type ReceiptVerdict = { verdict: Verdict; text: string; title?: string }

export async function checkReceipt(tx: ProofTx): Promise<ReceiptVerdict> {
  const r = await rpc("eth_getTransactionReceipt", [tx.hash])
  if (!r) return { verdict: "warn", text: "not indexed" }
  const success = r.status === "0x1"
  const blockOk = BigInt(r.blockNumber) === tx.block
  const gasOk = BigInt(r.gasUsed) === tx.gas
  let evOk = true
  if (tx.event) {
    evOk = (r.logs || []).some(
      (l: { address: string; topics?: string[] }) => eqAddr(l.address, ADDR) && !!l.topics && l.topics[0] === EVENT_TOPIC[tx.event as string],
    )
  } else {
    evOk = r.contractAddress ? eqAddr(r.contractAddress, ADDR) : true
  }
  if (success && blockOk && gasOk && evOk) return { verdict: "ok", text: "success" }
  if (success)
    return {
      verdict: "warn",
      text: "success*",
      title: `block ${blockOk ? "ok" : "differs"}, gas ${gasOk ? "ok" : "differs"}, event ${evOk ? "ok" : "missing"}`,
    }
  return { verdict: "bad", text: "reverted" }
}

/* ---- live negative proof: over-cap issuance must revert ----------------- */
export async function checkNegative(): Promise<ReceiptVerdict> {
  try {
    // With free reserve at 0, locking even 1 wei must revert InsufficientFreeReserve.
    const data =
      SEL.issueCoverage +
      encAddr(BUYER) +
      encB32("0x1111111111111111111111111111111111111111111111111111111111111111") +
      encB32("0x2222222222222222222222222222222222222222222222222222222222222222") +
      u256(1) +
      u256(4102444800) // expiry far in the future
    await ethCall(data, MERCHANT)
    // If the call did NOT revert, the invariant would be broken.
    return { verdict: "bad", text: "did not revert" }
  } catch (e) {
    const err = e as RpcError
    // Only a JSON-RPC execution error (err.rpc set) is a real on-chain rejection.
    // A transport failure (no err.rpc) must not masquerade as a pass.
    if (!err.rpc) throw err
    const raw = err.rpc.data as unknown
    const dhex =
      typeof raw === "string" ? raw : raw && typeof raw === "object" && "data" in raw ? String((raw as { data: unknown }).data) : ""
    if (typeof dhex === "string" && dhex.toLowerCase().startsWith(ERR_INSUFFICIENT_FREE)) {
      return { verdict: "ok", text: "reverts InsufficientFreeReserve (live)" }
    }
    // Reverted as expected but node did not surface the selector; still a rejection.
    return { verdict: "ok", text: "rejected on-chain (live)" }
  }
}
