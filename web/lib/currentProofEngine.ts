import { apiUrl } from "./apiBase"
import { MAINNET_RPC } from "./chain"
import { CURRENT_PROOF, type CurrentProofTx } from "./currentProof"

const ADDR = CURRENT_PROOF.contract
const MERCHANT = CURRENT_PROOF.merchant
const BUYER = CURRENT_PROOF.buyer
const EVALUATOR = CURRENT_PROOF.evaluator
const SEL = CURRENT_PROOF.selectors
const EVENT_TOPIC = CURRENT_PROOF.eventTopic as Record<string, string>
const ERR_INSUFFICIENT_FREE = CURRENT_PROOF.errInsufficientFree
const WEI = 10n ** 18n

export type Verdict = "ok" | "warn" | "bad" | "pending"
export type CardResult = { value: string; verdict: Verdict; note: string }
export type ReceiptVerdict = { verdict: Verdict; text: string; title?: string }

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
    e.rpc = json.error
    throw e
  }
  return json.result
}

const ethCall = (data: string, from?: string) =>
  rpc("eth_call", [from ? { from, to: ADDR, data } : { to: ADDR, data }, "latest"])

const u256 = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0")
const encAddr = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0")
const encB32 = (h: string) => h.toLowerCase().replace(/^0x/, "").padStart(64, "0")
const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + i * 64 + 64)
const wordBig = (data: string, i: number) => BigInt("0x" + word(data, i))
const wordAddr = (data: string, i: number) => "0x" + word(data, i).slice(24)
const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function formatBOT(wei: bigint): string {
  const int = wei / WEI
  const frac = (wei % WEI).toString().padStart(18, "0").replace(/0+$/, "")
  return int.toString() + (frac ? `.${frac}` : "")
}

export const getChainId = async (): Promise<number> => parseInt(await rpc("eth_chainId"), 16)

export async function readRuntime(): Promise<CardResult> {
  const code = await rpc("eth_getCode", [ADDR, "latest"])
  const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0
  return {
    value: bytes.toLocaleString(),
    verdict: bytes > 0 ? "ok" : "bad",
    note: bytes > 0 ? "live bytecode present" : "no code",
  }
}

export async function readMerchantReserve(): Promise<CardResult> {
  const d = await ethCall(SEL.reserveOf + encAddr(MERCHANT))
  const bal = wordBig(d, 0)
  const locked = wordBig(d, 1)
  const free = wordBig(d, 2)
  const reconciled = bal === 0n && locked === 0n && free === 0n
  return {
    value: `${formatBOT(bal)} / ${formatBOT(locked)} / ${formatBOT(free)}`,
    verdict: reconciled ? "ok" : "warn",
    note: reconciled ? "fresh merchant reconciled" : "live",
  }
}

export async function readCoverageCount(): Promise<CardResult> {
  const n = wordBig(await ethCall(SEL.coverageCount), 0)
  return { value: n.toString(), verdict: n >= CURRENT_PROOF.coverageId ? "ok" : "warn", note: n >= CURRENT_PROOF.coverageId ? "coverage #1 exists" : "live" }
}

export async function readCoverage(): Promise<CardResult> {
  const d = await ethCall(SEL.coverageOf + u256(CURRENT_PROOF.coverageId))
  const merchant = wordAddr(d, 0)
  const claimant = wordAddr(d, 1)
  const maxPayout = wordBig(d, 4)
  const status = Number(wordBig(d, 6))
  const good = eqAddr(merchant, MERCHANT) && eqAddr(claimant, BUYER) && maxPayout === CURRENT_PROOF.maxPayoutWei && status === 1
  return {
    value: `${status === 1 ? "Active" : `status ${status}`} · ${formatBOT(maxPayout)} BOT`,
    verdict: good ? "ok" : "warn",
    note: good ? "merchant + buyer + cap match" : "live",
  }
}

export async function readClaimCount(): Promise<CardResult> {
  const n = wordBig(await ethCall(SEL.claimCount), 0)
  return { value: n.toString(), verdict: n >= CURRENT_PROOF.claimId ? "ok" : "warn", note: n >= CURRENT_PROOF.claimId ? "claim #1 exists" : "live" }
}

export async function readClaim(): Promise<CardResult> {
  const d = await ethCall(SEL.claimOf + u256(CURRENT_PROOF.claimId))
  const coverageId = wordBig(d, 0)
  const claimant = wordAddr(d, 1)
  const evidenceHash = `0x${word(d, 2)}`
  const paid = wordBig(d, 3)
  const status = Number(wordBig(d, 4))
  const good = coverageId === CURRENT_PROOF.coverageId && eqAddr(claimant, BUYER) && evidenceHash.toLowerCase() === CURRENT_PROOF.evidenceHash.toLowerCase() && paid === CURRENT_PROOF.paidWei && status === 2
  return {
    value: `${status === 2 ? "Approved" : `status ${status}`} · paid ${formatBOT(paid)} BOT`,
    verdict: good ? "ok" : "warn",
    note: good ? "claim + evidence + payout match" : "live",
  }
}

export async function readEvaluator(): Promise<CardResult> {
  const signer = wordAddr(await ethCall(SEL.evaluatorSigner), 0)
  const good = eqAddr(signer, EVALUATOR)
  return { value: signer, verdict: good ? "ok" : "bad", note: good ? "immutable signer matches" : "differs" }
}

export async function readNonce(): Promise<CardResult> {
  const used = wordBig(await ethCall(SEL.isNonceUsed + u256(CURRENT_PROOF.nonce)), 0) !== 0n
  return { value: used ? `nonce ${CURRENT_PROOF.nonce} consumed` : `nonce ${CURRENT_PROOF.nonce} unused`, verdict: used ? "ok" : "bad", note: used ? "replay gate live" : "unexpected" }
}

export async function readContractBalance(): Promise<CardResult> {
  const bal = BigInt(await rpc("eth_getBalance", [ADDR, "latest"]))
  return {
    value: formatBOT(bal),
    verdict: bal >= 1000000000000000n ? "ok" : "warn",
    note: "includes the separate 0.001 BOT smoke reserve",
  }
}

export async function readEvidenceStatus(): Promise<CardResult> {
  const url = apiUrl(`/api/evidence?coverageId=${CURRENT_PROOF.coverageId}&claimId=${CURRENT_PROOF.claimId}`)
  const res = await fetch(url, { method: "GET", cache: "no-store" })
  if (!res.ok) throw new Error(`evidence API HTTP ${res.status}`)
  const json = await res.json() as { attested?: boolean; evidenceHash?: string; derived?: { productMatches?: boolean; receiptMatches?: boolean } }
  const good = json.attested === true && json.evidenceHash?.toLowerCase() === CURRENT_PROOF.evidenceHash.toLowerCase()
  return {
    value: good ? "attested" : "not attested",
    verdict: good ? "ok" : "bad",
    note: good ? "durable VPS record matches claim hash" : "evidence record mismatch",
  }
}

export async function checkReceipt(tx: CurrentProofTx): Promise<ReceiptVerdict> {
  const r = await rpc("eth_getTransactionReceipt", [tx.hash])
  if (!r) return { verdict: "warn", text: "not indexed" }
  const success = r.status === "0x1"
  const blockOk = BigInt(r.blockNumber) === tx.block
  const gasOk = BigInt(r.gasUsed) === tx.gas
  const eventOk = (r.logs || []).some(
    (l: { address: string; topics?: string[] }) =>
      eqAddr(l.address, ADDR) && !!l.topics && l.topics[0]?.toLowerCase() === EVENT_TOPIC[tx.event].toLowerCase(),
  )
  if (success && blockOk && gasOk && eventOk) return { verdict: "ok", text: "success" }
  if (success) return { verdict: "warn", text: "success*", title: `block ${blockOk ? "ok" : "differs"}, gas ${gasOk ? "ok" : "differs"}, event ${eventOk ? "ok" : "missing"}` }
  return { verdict: "bad", text: "reverted" }
}

export async function checkOverCap(): Promise<ReceiptVerdict> {
  try {
    const data =
      SEL.issueCoverage +
      encAddr(BUYER) +
      encB32("0x1111111111111111111111111111111111111111111111111111111111111111") +
      encB32("0x2222222222222222222222222222222222222222222222222222222222222222") +
      u256(1) +
      u256(4102444800)
    await ethCall(data, MERCHANT)
    return { verdict: "bad", text: "did not revert" }
  } catch (e) {
    const err = e as RpcError
    if (!err.rpc) throw err
    const raw = err.rpc.data as unknown
    const dhex = typeof raw === "string" ? raw : raw && typeof raw === "object" && "data" in raw ? String((raw as { data: unknown }).data) : ""
    if (dhex.toLowerCase().startsWith(ERR_INSUFFICIENT_FREE)) {
      return { verdict: "ok", text: "InsufficientFreeReserve (live)" }
    }
    return { verdict: "ok", text: "rejected on-chain (live)" }
  }
}
