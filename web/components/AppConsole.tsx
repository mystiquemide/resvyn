"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Cpu,
  FileCheck2,
  Landmark,
  Loader2,
  RefreshCw,
  Store,
  User,
  Wallet,
} from "lucide-react"
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  isAddress,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
} from "viem"
import {
  useBalance,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
  useWriteContract,
} from "wagmi"
import NetworkBadge from "./NetworkBadge"
import ReserveMeter from "./ReserveMeter"
import StatusDot from "./StatusDot"
import {
  APP_CHAIN,
  APP_CONTRACT_ADDRESS,
  DEPLOY_START_BLOCK,
  EXPECTED_EVALUATOR,
  PROOF,
  evaluatorSignerMatches,
  explorerTx,
  isAppContractReady,
  isArchivedProofInstance,
  isOperationalDeployment,
  warrantyReserveAbi,
} from "@/lib/chain"
import { formatBOT, parseBOT, shortAddr } from "@/lib/format"
import { evidenceContentHash, type EvidenceContent } from "@/lib/evidenceContent"
import { evaluateMessage, intakeMessage } from "@/lib/evaluateAuth"

type Tone = "ok" | "idle" | "pending" | "warn" | "fail"
type ActionKey = "deposit" | "issue" | "open" | "evaluate" | "resolve" | "withdraw" | "probe"
type TxStatus = "idle" | "pending" | "confirmed" | "failed"

type TxState = {
  status: TxStatus
  hash?: Hex
  message?: string
}

type LogEntry = {
  id: string
  event: string
  detail: string
  tone: Tone
  hash?: Hex
}

type CoverageRow = {
  id: bigint
  merchant: Address
  claimant: Address
  maxPayout: bigint
  expiry: bigint
  status: number
  claimId: bigint
}

type ClaimRow = {
  id: bigint
  coverageId: bigint
  claimant: Address
  evidenceHash: Hex
  paidAmount: bigint
  status: number
}

type SignedDecision = {
  model: { decision: string; approvedAmount: string; reasonCode: string; confidenceBand: string; modelVersion: string }
  decision: {
    chainId: bigint
    verifier: Address
    claimId: bigint
    coverageId: bigint
    claimant: Address
    evidenceHash: Hex
    amount: bigint
    result: number
    modelVersion: Hex
    expiry: bigint
    nonce: bigint
  }
  signature: Hex
  signer: Address
}

const ZERO_TX: TxState = { status: "idle" }
const COVERAGE_STATUS = ["None", "Active", "Expired"] as const
const CLAIM_STATUS = ["None", "Open", "Approved", "Rejected"] as const

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--color-hairline)",
  borderRadius: 12,
  padding: "10px 12px",
  background: "#fff",
  color: "var(--color-ink)",
  fontFamily: "var(--font-sans)",
  fontSize: "0.92rem",
}

function hashText(value: string): Hex {
  return keccak256(stringToHex(value.trim() || "resvyn-empty"))
}

function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      const args = reverted.data?.args
      if (name === "InsufficientFreeReserve" && Array.isArray(args) && args.length >= 2) {
        return `Not enough free reserve. You have ${formatBOT(args[0] as bigint)} BOT free; this needs ${formatBOT(args[1] as bigint)}. Deposit more or lower the payout.`
      }
      if (name === "WithdrawalExceedsFreeReserve" && Array.isArray(args) && args.length >= 2) {
        return `Only free reserve can be withdrawn. You have ${formatBOT(args[0] as bigint)} free; you asked for ${formatBOT(args[1] as bigint)}.`
      }
      if (name) return name
      if (reverted.raw) {
        try {
          return decodeErrorResult({ abi: warrantyReserveAbi, data: reverted.raw }).errorName
        } catch {
          /* fall through */
        }
      }
    }
    return sanitizeError(err.shortMessage || err.message)
  }
  if (err instanceof Error) return sanitizeError(err.message)
  return "Transaction failed. Nothing was sent. Try again, or check your wallet for the reason."
}

// Strip URLs and cap length so raw RPC or system detail never reaches the UI.
function sanitizeError(message: string): string {
  const clean = message.replace(/https?:\/\/\S+/g, "the network").replace(/\s+/g, " ").trim()
  const capped = clean.length > 160 ? `${clean.slice(0, 157)}…` : clean
  return capped || "Transaction failed. Nothing was sent. Try again, or check your wallet for the reason."
}

function addDays(days: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.max(1, days) * 86400)
}

function liveClaimLabel(claims: ClaimRow[]): string {
  const c = claims.find((cl) => cl.id === 1n)
  if (!c) return "Reading…"
  return CLAIM_STATUS[c.status] ?? `status ${c.status}`
}

function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { ethereum?: unknown }).ethereum)
}

export default function AppConsole() {
  const deployed = isAppContractReady(APP_CONTRACT_ADDRESS)
  const contract = deployed ? APP_CONTRACT_ADDRESS : undefined

  const { address, isConnected, chainId, status } = useConnection()
  const connectors = useConnectors()
  const { mutateAsync: connect, isPending: connecting } = useConnect()
  const { mutateAsync: disconnect } = useDisconnect()
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: APP_CHAIN.id })
  const { mutateAsync: writeContract } = useWriteContract()
  const { data: walletBal } = useBalance({
    address,
    chainId: APP_CHAIN.id,
    query: { enabled: Boolean(address) },
  })

  const onAppChain = chainId === APP_CHAIN.id
  // REV-002: writes are enabled only for a manifest-verified operational
  // deployment. The default archived proof instance is strictly read-only:
  // no deposit, issuance, claim, settlement, or withdrawal against it.
  const operational = isOperationalDeployment(APP_CONTRACT_ADDRESS)

  const [reserve, setReserve] = useState({ balance: 0n, locked: 0n, free: 0n })
  const [evaluator, setEvaluator] = useState<Address | null>(null)
  const [coverages, setCoverages] = useState<CoverageRow[]>([])
  const [claims, setClaims] = useState<ClaimRow[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [txs, setTxs] = useState<Record<ActionKey, TxState>>({
    deposit: ZERO_TX,
    issue: ZERO_TX,
    open: ZERO_TX,
    evaluate: ZERO_TX,
    resolve: ZERO_TX,
    withdraw: ZERO_TX,
    probe: ZERO_TX,
  })

  const [depositAmt, setDepositAmt] = useState("")
  const [claimant, setClaimant] = useState("")
  const [maxPayout, setMaxPayout] = useState("")
  const [productNote, setProductNote] = useState("")
  const [receiptNote, setReceiptNote] = useState("")
  const [expiryDays, setExpiryDays] = useState("")
  const [openCoverageId, setOpenCoverageId] = useState("")
  const [evidenceNote, setEvidenceNote] = useState("")
  const [evalCoverageId, setEvalCoverageId] = useState("")
  const [evalClaimId, setEvalClaimId] = useState("")
  const [requestedAmt, setRequestedAmt] = useState("0.001")
  const [signals, setSignals] = useState({
    productMatches: true,
    damageEligible: true,
    evidenceComplete: true,
    fileIntegrityOk: true,
  })
  const [withdrawAmt, setWithdrawAmt] = useState("")
  const [signed, setSigned] = useState<SignedDecision | null>(null)
  const [noWallet, setNoWallet] = useState(false)
  const [instance, setInstance] = useState({ balance: 0n, locked: 0n, free: 0n, nonceUsed: false })
  // REV-001 round 3: the evidence content is built ONCE when the claim is
  // opened and the exact snapshot is kept in state, so the hash committed
  // on-chain is byte-identical to the content attested at /api/evidence
  // (REV-016). issuedAt is fixed at snapshot time - never recomputed per
  // call - so a one-second drift cannot break the commitment.
  const [evidenceSnapshot, setEvidenceSnapshot] = useState<{
    content: EvidenceContent
    hash: Hex
    claimId: string
    coverageId: string
  } | null>(null)

  // REV-016: the attested flag belongs to a specific claim. Reset it whenever
  // the claim/coverage references or the evidence fields change, so a stale
  // "attested" state can never unlock evaluation for different inputs.
  const [evidenceAttested, setEvidenceAttested] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      setEvidenceAttested(false)
      setSigned(null)
    }, 0)
    return () => clearTimeout(t)
  }, [evalCoverageId, evalClaimId, evidenceSnapshot, productNote, receiptNote, evidenceNote, requestedAmt, signals.damageEligible, signals.evidenceComplete, signals.fileIntegrityOk])

  // REV-002 round 2: when the operator pinned an expected evaluator signer,
  // the live on-chain signer must match it or the app renders read-only.
  // REV-002 round 3: a pinned evaluator is REQUIRED for writes - without
  // NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR, evaluatorSignerMatches returns
  // false, so no deposit/issuance can happen before evaluator compatibility
  // is established.
  const signerOk = evaluatorSignerMatches(EXPECTED_EVALUATOR, evaluator ?? undefined)
  const canWrite = Boolean(operational && signerOk && isConnected && onAppChain && deployed && contract && address)

  useEffect(() => {
    if (address && !claimant) {
      // Defer so the state write is not synchronous inside the effect.
      const t = setTimeout(() => setClaimant(address), 0)
      return () => clearTimeout(t)
    }
  }, [address, claimant])

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLog((prev) => [{ id: `${Date.now()}-${prev.length}`, ...entry }, ...prev].slice(0, 40))
  }, [])

  const setAction = (key: ActionKey, next: TxState) => {
    setTxs((prev) => ({ ...prev, [key]: next }))
  }

  const refresh = useCallback(async () => {
    if (!publicClient || !contract || !deployed) return
    setReading(true)
    setReadError(null)
    try {
      const merchant = (address ?? "0x0000000000000000000000000000000000000000") as Address
      const [res, signer, covCount, claimCount, proofReserve, nonceUsed] = await Promise.all([
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "reserveOf", args: [merchant] }),
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "evaluatorSigner" }),
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "coverageCount" }),
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "claimCount" }),
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "reserveOf", args: [PROOF.merchant] }),
        publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "isNonceUsed", args: [1n] }),
      ])
      const [balance, locked, free] = res
      setReserve({ balance, locked, free })
      setEvaluator(signer)
      setInstance({
        balance: proofReserve[0],
        locked: proofReserve[1],
        free: proofReserve[2],
        nonceUsed: Boolean(nonceUsed),
      })

      // REV-009 round 2: rows are ALWAYS re-read on refresh. Claim status and
      // paidAmount change on settlement without claimCount changing, and
      // coverage status changes on expiry without coverageCount changing, so
      // a counts-based cache would show stale state. Reads stay bounded: at
      // most 12 coverage rows + 12 claim rows, and the log scan below is
      // limited to the deployment start block.
      const lastCov = Number(covCount > 12n ? 12n : covCount)
      const covRows: CoverageRow[] = []
      for (let i = 0; i < lastCov; i++) {
        const id = covCount - BigInt(i)
        const [cov, boundClaim] = await Promise.all([
          publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "coverageOf", args: [id] }),
          publicClient.readContract({ address: contract, abi: warrantyReserveAbi, functionName: "claimIdOfCoverage", args: [id] }),
        ])
        covRows.push({
          id,
          merchant: cov.merchant,
          claimant: cov.claimant,
          maxPayout: cov.maxPayout,
          expiry: cov.expiry,
          status: Number(cov.status),
          claimId: boundClaim,
        })
      }
      setCoverages(covRows)

      const lastClaim = Number(claimCount > 12n ? 12n : claimCount)
      const claimRows: ClaimRow[] = []
      for (let i = 0; i < lastClaim; i++) {
        const id = claimCount - BigInt(i)
        const claim = await publicClient.readContract({
          address: contract,
          abi: warrantyReserveAbi,
          functionName: "claimOf",
          args: [id],
        })
        claimRows.push({
          id,
          coverageId: claim.coverageId,
          claimant: claim.claimant,
          evidenceHash: claim.evidenceHash,
          paidAmount: claim.paidAmount,
          status: Number(claim.status),
        })
      }
      setClaims(claimRows)

      // REV-009: bound the historical log scan to this deployment's start
      // block instead of rescanning the whole chain from block 0. Only the
      // most recent events are needed for the session log.
      try {
        const raw = await publicClient.getLogs({ address: contract, fromBlock: DEPLOY_START_BLOCK, toBlock: "latest" })
        const decoded = parseEventLogs({ abi: warrantyReserveAbi, logs: raw })
        const fromChain: LogEntry[] = decoded
          .slice(-20)
          .reverse()
          .map((ev, idx) => ({
            id: `chain-${ev.transactionHash}-${idx}`,
            event: ev.eventName,
            detail: summarizeEvent(ev.eventName, ev.args as Record<string, unknown>),
            tone: ev.eventName.startsWith("Claim") && ev.eventName.endsWith("Rejected") ? "fail" : "ok",
            hash: ev.transactionHash,
          }))
        if (fromChain.length) {
          setLog((prev) => {
            const seen = new Set(fromChain.map((e) => e.id))
            return [...fromChain, ...prev.filter((e) => !seen.has(e.id))].slice(0, 40)
          })
        }
      } catch {
        /* historical logs are optional; session log still works */
      }
    } catch (err) {
      setReadError(describeError(err))
    } finally {
      setReading(false)
    }
  }, [publicClient, contract, deployed, address])

  useEffect(() => {
    // Defer the first refresh so its synchronous setReading(true) does not
    // run inside the effect body (react-hooks/set-state-in-effect).
    const t = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(t)
  }, [refresh])

  async function addAppChain() {
    if (!walletClient) throw new Error("No wallet found. Install MetaMask, or open this page in a wallet browser.")
    await walletClient.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${APP_CHAIN.id.toString(16)}`,
          chainName: APP_CHAIN.name,
          nativeCurrency: APP_CHAIN.nativeCurrency,
          rpcUrls: [...APP_CHAIN.rpcUrls.default.http],
          blockExplorerUrls: [APP_CHAIN.blockExplorers.default.url],
        },
      ],
    })
  }

  async function onConnect() {
    const injected = connectors.find((c) => c.id === "injected" || c.type === "injected") ?? connectors[0]
    if (!injected || !hasInjectedWallet()) {
      setNoWallet(true)
      pushLog({ event: "No wallet", detail: "No injected wallet in this browser.", tone: "warn" })
      return
    }
    setNoWallet(false)
    try {
      await connect({ connector: injected })
    } catch {
      pushLog({ event: "Connect failed", detail: "Couldn't connect. Open your wallet and tap Connect again.", tone: "fail" })
    }
  }

  async function onSwitch() {
    try {
      await switchChain({ chainId: APP_CHAIN.id })
    } catch {
      try {
        await addAppChain()
        await switchChain({ chainId: APP_CHAIN.id })
      } catch {
        pushLog({ event: "Network switch failed", detail: "Couldn't switch networks. In your wallet, switch to BOT Chain Mainnet (chain 677).", tone: "fail" })
      }
    }
  }

  async function send(key: ActionKey, label: string, write: () => Promise<Hex>) {
    if (!canWrite || !publicClient) return
    setAction(key, { status: "pending", message: "Waiting for wallet…" })
    try {
      const hash = await write()
      setAction(key, { status: "pending", hash, message: "Submitted. Waiting for confirmation…" })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== "success") {
        setAction(key, { status: "failed", hash, message: "Transaction was rejected. Nothing was sent. Check the wallet prompt or the amount, then try again." })
        pushLog({ event: `${label} reverted`, detail: hash, tone: "fail", hash })
        return
      }
      const decoded = parseEventLogs({ abi: warrantyReserveAbi, logs: receipt.logs })
      const names = decoded.map((e) => e.eventName).join(", ") || "confirmed"
      setAction(key, { status: "confirmed", hash, message: names })
      pushLog({ event: label, detail: names, tone: "ok", hash })
      if (key === "issue") {
        const issued = decoded.find((e) => e.eventName === "CoverageIssued")
        if (issued && "coverageId" in issued.args) {
          const id = String(issued.args.coverageId)
          setOpenCoverageId(id)
          setEvalCoverageId(id)
        }
      }
      if (key === "open") {
        const opened = decoded.find((e) => e.eventName === "ClaimOpened")
        if (opened && "claimId" in opened.args) {
          const id = String(opened.args.claimId)
          setEvalClaimId(id)
          // REV-016: bind the committed evidence snapshot to the REAL opened
          // claim id so attestation can never target a different claim.
          setEvidenceSnapshot((prev) =>
            prev ? { ...prev, claimId: id, coverageId: String(opened.args.coverageId ?? prev.coverageId) } : prev,
          )
        }
      }
      await refresh()
    } catch (err) {
      const message = describeError(err)
      setAction(key, { status: "failed", message })
      pushLog({ event: `${label} failed`, detail: message, tone: "fail" })
    }
  }

  async function onDeposit() {
    if (!contract) return
    let value: bigint
    try {
      value = parseBOT(depositAmt)
    } catch (err) {
      setAction("deposit", { status: "failed", message: err instanceof Error ? err.message : "Enter a valid amount in BOT." })
      return
    }
    if (value === 0n) {
      setAction("deposit", { status: "failed", message: "Enter an amount greater than zero." })
      return
    }
    await send("deposit", "Deposit reserve", () =>
      writeContract({
        address: contract,
        abi: warrantyReserveAbi,
        functionName: "depositReserve",
        value,
      }),
    )
  }

  async function onIssue() {
    if (!contract) return
    if (!isAddress(claimant)) {
      setAction("issue", { status: "failed", message: "Claimant must be a valid address" })
      return
    }
    let payout: bigint
    try {
      payout = parseBOT(maxPayout)
    } catch (err) {
      setAction("issue", { status: "failed", message: err instanceof Error ? err.message : "Enter a valid payout in BOT." })
      return
    }
    const days = Number(expiryDays)
    if (!Number.isFinite(days) || days <= 0) {
      setAction("issue", { status: "failed", message: "Expiry must be a positive number of days" })
      return
    }
    await send("issue", "Issue coverage", () =>
      writeContract({
        address: contract,
        abi: warrantyReserveAbi,
        functionName: "issueCoverage",
        args: [claimant, hashText(productNote), hashText(receiptNote), payout, addDays(days)],
      }),
    )
  }

  // REV-001 round 3: the evidence content. productMatches is NOT a client
  // field anymore: the server derives it by comparing noteHash(productNote)
  // against the coverage's on-chain productHash (and receiptHash likewise).
  // The remaining flags are self-attestations, documented as such.
  function currentEvidenceContent(): EvidenceContent {
    return {
      productNote: productNote.trim() || "resvyn-empty",
      receiptNote: receiptNote.trim() || "resvyn-empty",
      damageDescription: evidenceNote.trim(),
      damageEligible: signals.damageEligible,
      evidenceComplete: signals.evidenceComplete,
      fileIntegrityOk: signals.fileIntegrityOk,
      requestedAmountWei: requestedAmt.trim() === "" ? "0" : parseBOT(requestedAmt).toString(),
      issuedAt: Math.floor(Date.now() / 1000) - 3600,
    }
  }

  async function onOpen() {
    if (!contract) return
    let coverageId: bigint
    try {
      coverageId = BigInt(openCoverageId)
    } catch {
      setAction("open", { status: "failed", message: "Coverage id must be a whole number, like 1 or 2." })
      return
    }
    if (coverageId <= 0n) {
      setAction("open", { status: "failed", message: "Coverage id must be a whole number, like 1 or 2." })
      return
    }
    // REV-016: build the content ONCE, keep the exact snapshot in state, and
    // open the claim with its hash. Attestation later reuses this snapshot so
    // the committed hash and the attested content can never drift.
    const content = currentEvidenceContent()
    const hash = evidenceContentHash(content)
    setEvidenceSnapshot({ content, hash, claimId: String(openCoverageId), coverageId: String(openCoverageId) })
    await send("open", "Open claim", () =>
      writeContract({
        address: contract,
        abi: warrantyReserveAbi,
        functionName: "openClaim",
        args: [coverageId, hash],
      }),
    )
  }

  // REV-001 round 3 step 1: attest the evidence content to the server. The
  // claimant/merchant signs the intake message; the server verifies the
  // content hashes to the on-chain claim.evidenceHash, derives product/
  // receipt matches against the coverage's on-chain hashes, and stores the
  // record server-side (first write wins, claim-bound).
  async function onAttestEvidence() {
    if (!walletClient || !address) {
      setAction("evaluate", { status: "failed", message: "Connect a wallet on BOT Chain Mainnet to attest evidence." })
      return
    }
    // REV-016: attest the EXACT snapshot that was committed when the claim
    // was opened. Rebuilding the content now could drift (issuedAt, notes)
    // and produce a hash that no longer matches the on-chain commitment.
    if (!evidenceSnapshot) {
      setAction("evaluate", { status: "failed", message: "Open the claim first: the evidence snapshot committed on-chain is required for attestation." })
      return
    }
    setAction("evaluate", { status: "pending", message: "Waiting for your evidence signature…" })
    try {
      const coverageId = String(BigInt(evalCoverageId))
      const claimId = String(BigInt(evalClaimId))
      const content = evidenceSnapshot.content
      const evidenceHash = evidenceSnapshot.hash
      const timestamp = Math.floor(Date.now() / 1000)
      const msg = intakeMessage({
        chainId: APP_CHAIN.id,
        verifier: contract as Address,
        coverageId,
        claimId,
        evidenceHash,
        content,
        timestamp,
      })
      const signature = await walletClient.signMessage({ message: msg })
      setAction("evaluate", { status: "pending", message: "Submitting evidence to the server…" })
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coverageId,
          claimId,
          evidence: content,
          signer: address,
          signature,
          timestamp,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        const msg2 =
          res.status === 429
            ? "Too many requests. Wait a minute, then try again."
            : body.message || body.error || "Evidence refused"
        setAction("evaluate", { status: "failed", message: msg2 })
        pushLog({ event: "Evidence refused", detail: msg2, tone: "warn" })
        return
      }
      setEvidenceAttested(true)
      setAction("evaluate", { status: "confirmed", message: "Evidence attested server-side" })
      pushLog({ event: "Evidence attested", detail: `hash ${body.evidenceHash.slice(0, 12)}…`, tone: "ok" })
    } catch (err) {
      setAction("evaluate", { status: "failed", message: describeError(err) })
    }
  }

  // REV-001 round 2 step 2: request evaluation. The body carries ONLY the
  // claim references and an authorization signature - no evidence fields, no
  // amount. The server derives everything from its stored evidence record.
  async function onEvaluate() {
    if (!walletClient || !address) {
      setAction("evaluate", { status: "failed", message: "Connect a wallet on BOT Chain Mainnet to evaluate." })
      return
    }
    setAction("evaluate", { status: "pending", message: "Waiting for your authorization signature…" })
    setSigned(null)
    try {
      const coverageId = String(BigInt(evalCoverageId))
      const claimId = String(BigInt(evalClaimId))
      const timestamp = Math.floor(Date.now() / 1000)
      const msg = evaluateMessage({
        chainId: APP_CHAIN.id,
        verifier: contract as Address,
        coverageId,
        claimId,
        timestamp,
      })
      const signature = await walletClient.signMessage({ message: msg })
      setAction("evaluate", { status: "pending", message: "Asking the evaluator…" })
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coverageId,
          claimId,
          signer: address,
          signature,
          timestamp,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        const msg2 =
          res.status === 429
            ? "Too many evaluate requests. Wait a minute, then try again."
            : body.message || body.error || "Evaluator refused"
        setAction("evaluate", { status: "failed", message: msg2 })
        pushLog({ event: "Evaluator refused", detail: msg2, tone: "warn" })
        return
      }
      const d = body.decision
      const next: SignedDecision = {
        model: body.model,
        decision: {
          chainId: BigInt(d.chainId),
          verifier: d.verifier,
          claimId: BigInt(d.claimId),
          coverageId: BigInt(d.coverageId),
          claimant: d.claimant,
          evidenceHash: d.evidenceHash,
          amount: BigInt(d.amount),
          result: Number(d.result),
          modelVersion: d.modelVersion,
          expiry: BigInt(d.expiry),
          nonce: BigInt(d.nonce),
        },
        signature: body.signature,
        signer: body.signer,
      }
      setSigned(next)
      setAction("evaluate", {
        status: "confirmed",
        message: `${next.model.decision} · ${next.model.reasonCode}`,
      })
      pushLog({
        event: "Decision signed",
        detail: `${next.model.decision} ${next.model.reasonCode} · ${formatBOT(next.decision.amount)} BOT`,
        tone: next.model.decision === "APPROVE" ? "ok" : "warn",
      })
    } catch (err) {
      setAction("evaluate", { status: "failed", message: describeError(err) })
    }
  }

  async function onResolve() {
    if (!contract || !signed) {
      setAction("resolve", { status: "failed", message: "Evaluate the claim first, then settle with the signed decision." })
      return
    }
    await send("resolve", "Resolve claim", () =>
      writeContract({
        address: contract,
        abi: warrantyReserveAbi,
        functionName: "resolveClaim",
        args: [signed.decision, signed.signature],
      }),
    )
  }

  async function onWithdraw() {
    if (!contract) return
    let amount: bigint
    try {
      amount = parseBOT(withdrawAmt || "0")
    } catch (err) {
      setAction("withdraw", { status: "failed", message: err instanceof Error ? err.message : "Enter a valid amount in BOT." })
      return
    }
    if (amount === 0n) {
      setAction("withdraw", { status: "failed", message: "Withdraw amount must be greater than zero" })
      return
    }
    await send("withdraw", "Withdraw free reserve", () =>
      writeContract({
        address: contract,
        abi: warrantyReserveAbi,
        functionName: "withdrawReserve",
        args: [amount],
      }),
    )
  }

  async function onProbe() {
    if (!publicClient || !contract || !address) {
      setAction("probe", { status: "failed", message: "Connect a wallet on BOT Chain Mainnet to run the guardrail test." })
      return
    }
    setAction("probe", { status: "pending", message: "Simulating guardrails (no state change)…" })
    const notes: string[] = []
    try {
      try {
        await publicClient.simulateContract({
          address: contract,
          abi: warrantyReserveAbi,
          functionName: "issueCoverage",
          account: address,
          args: [
            address,
            hashText("overcap"),
            hashText("overcap"),
            reserve.free + 1n,
            addDays(30),
          ],
        })
        notes.push("over-cap issuance unexpectedly succeeded in simulation")
      } catch (err) {
        notes.push(`over-cap: ${describeError(err)}`)
      }
      if (signed) {
        try {
          await publicClient.simulateContract({
            address: contract,
            abi: warrantyReserveAbi,
            functionName: "resolveClaim",
            account: address,
            args: [signed.decision, signed.signature],
          })
          notes.push("replay resolve unexpectedly succeeded in simulation")
        } catch (err) {
          notes.push(`replay: ${describeError(err)}`)
        }
      } else {
        notes.push("replay: skipped (no signed decision in this session)")
      }
      setAction("probe", { status: "confirmed", message: "Call-level checks finished" })
      pushLog({ event: "Guardrail probe", detail: notes.join(" · "), tone: "ok" })
    } catch (err) {
      setAction("probe", { status: "failed", message: describeError(err) })
    }
  }

  const gate = useMemo(() => {
    // REV-002: the archived proof instance is read-only, whatever the wallet.
    if (deployed && isArchivedProofInstance(APP_CONTRACT_ADDRESS)) {
      return {
        tone: "warn" as Tone,
        title: "This is the archived proof instance (read-only)",
        body:
          "The configured contract is the recorded Mainnet proof deployment, whose evaluator signer is no longer in use. Deposit, issuance, claim, settlement, and withdrawal are disabled so no real BOT can be locked without a working settlement path. Verify the proof on /proof. Point NEXT_PUBLIC_RESVYN_ADDRESS at a verified operational deployment and set NEXT_PUBLIC_RESVYN_OPERATIONAL=1 to enable writes.",
      }
    }
    // REV-002 round 2: the pinned expected evaluator signer must match the
    // live on-chain signer, or the deployment cannot settle anything.
    // REV-002 round 3: a pinned evaluator manifest is REQUIRED — without
    // NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR the app is read-only too.
    if (deployed && !signerOk) {
      return {
        tone: "warn" as Tone,
        title: EXPECTED_EVALUATOR ? "Evaluator signer mismatch (read-only)" : "Evaluator signer not pinned (read-only)",
        body: EXPECTED_EVALUATOR
          ? "This deployment's on-chain evaluator signer does not match NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR, so no decision signed here could ever settle. All writes are disabled until the deployment manifest is corrected."
          : "No evaluator signer is pinned (NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR is unset), so evaluator compatibility cannot be verified. All writes are disabled until the operator pins the expected signer.",
      }
    }
    if (!deployed) {
      return {
        tone: "warn" as Tone,
        title: "This workspace is not live yet",
        body: "This workspace is not connected to the Mainnet contract yet. You can look around, but funding, issuance, and settlement stay locked.",
      }
    }
    if (!isConnected) {
      return {
        tone: "idle" as Tone,
        title: "Connect a wallet",
        body: "This app is live on BOT Chain Mainnet. Connect an injected wallet to fund a reserve, issue coverage, open a claim, and settle it with a signed evaluator decision.",
      }
    }
    if (!onAppChain) {
      return {
        tone: "warn" as Tone,
        title: "Wrong network",
        body: "This wallet is on a different network. Switch to BOT Chain Mainnet before any write.",
      }
    }
    return null
  }, [deployed, isConnected, onAppChain, chainId, operational, signerOk])

  const busy = Object.values(txs).some((t) => t.status === "pending") || connecting || switching

  return (
    <section>
      <header style={{ maxWidth: 760 }}>
        <h1 className="display" style={{ fontSize: "clamp(2rem, 4.6vw, 3rem)", marginTop: 0 }}>
          Run the reserve lifecycle <span className="em">on Mainnet.</span>
        </h1>
        <p className="lead" style={{ marginTop: 16 }}>
          Fund a reserve, lock coverage, open a claim, and settle it with a bounded AI-signed decision.
          Writes go to BOT Chain Mainnet. They spend native BOT and are real transactions on chain 677.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginTop: 28,
        }}
      >
        <NetworkBadge label="BOT Chain Mainnet" tone="ok" />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={() => void refresh()} disabled={reading || !deployed} style={{ padding: "0.6rem 1rem" }}>
            <RefreshCw size={15} />
            {reading ? "Reading…" : "Refresh"}
          </button>
          <WalletButton
            status={status}
            address={address}
            connecting={connecting}
            onConnect={() => void onConnect()}
            onDisconnect={() => void disconnect()}
          />
        </div>
      </div>

      {noWallet && (
        <div className="card" style={{ marginTop: 20, padding: "18px 20px" }}>
          <div style={{ fontWeight: 600 }}>No wallet in this browser</div>
          <p style={{ margin: "6px 0 14px", color: "var(--color-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>
            Connect needs an injected wallet such as MetaMask. You can still verify the live Mainnet payout without one.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href="/proof">
              Verify the payout
            </a>
            <a className="btn btn-ghost" href={`https://metamask.app.link/dapp/${typeof window !== "undefined" ? window.location.host : ""}/app`}>
              Open in MetaMask
            </a>
          </div>
        </div>
      )}

      {gate && (
        <div
          className="card"
          style={{
            marginTop: 20,
            padding: "18px 20px",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
            borderColor: gate.tone === "warn" ? "color-mix(in srgb, #c98a1a 40%, var(--color-hairline))" : undefined,
          }}
        >
          <AlertTriangle size={18} color={gate.tone === "warn" ? "#c98a1a" : "var(--color-muted-2)"} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{gate.title}</div>
            <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>{gate.body}</p>
            {isConnected && !onAppChain && (
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => void onSwitch()} disabled={switching}>
                {switching ? "Switching…" : "Switch to BOT Chain Mainnet"}
              </button>
            )}
          </div>
        </div>
      )}

      {readError && (
        <p style={{ marginTop: 14, color: "var(--color-fail)", fontSize: "0.88rem" }}>Could not read the contract: {readError}</p>
      )}

      <div
        className="app-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.12fr) minmax(0, 0.88fr)",
          gap: 24,
          marginTop: 28,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ActionCard
            icon={Landmark}
            title="Fund the reserve"
            hint="Deposits native BOT into your merchant reserve. It stays free until coverage locks against it."
            disabled={!canWrite || busy}
            tx={txs.deposit}
            onSubmit={() => void onDeposit()}
            submit="Deposit"
          >
            <Field label="Amount (BOT)" htmlFor="deposit-amt">
              <input id="deposit-amt" style={inputStyle} value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} inputMode="decimal" placeholder="0.005" />
            </Field>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 10, padding: "0.5rem 0.9rem" }} onClick={() => setDepositAmt("0.005")}>
              Use 0.005 BOT
            </button>
            {walletBal && (
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--color-muted-2)" }}>
                Wallet {formatBOT(walletBal.value)} BOT
              </p>
            )}
          </ActionCard>

          <ActionCard
            icon={FileCheck2}
            title="Issue coverage"
            hint="Locks max payout from your free reserve. The claimant is the only address that can later open a claim."
            disabled={!canWrite || busy}
            tx={txs.issue}
            onSubmit={() => void onIssue()}
            submit="Issue coverage"
          >
            <Field label="Claimant" htmlFor="claimant">
              <input id="claimant" style={inputStyle} value={claimant} onChange={(e) => setClaimant(e.target.value)} spellCheck={false} placeholder="0xAbf0…43e9" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Max payout (BOT)" htmlFor="max-payout">
                <input id="max-payout" style={inputStyle} value={maxPayout} onChange={(e) => setMaxPayout(e.target.value)} inputMode="decimal" placeholder="0.001" />
              </Field>
              <Field label="Expiry (days)" htmlFor="expiry-days">
                <input id="expiry-days" style={inputStyle} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} inputMode="numeric" placeholder="30" />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Product note (hashed)" htmlFor="product-note">
                <input id="product-note" style={inputStyle} value={productNote} onChange={(e) => setProductNote(e.target.value)} placeholder="Alpine kettle, batch A12" />
              </Field>
              <Field label="Receipt note (hashed)" htmlFor="receipt-note">
                <input id="receipt-note" style={inputStyle} value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)} placeholder="Store ticket 1842" />
              </Field>
            </div>
            <ExampleCoverage />
          </ActionCard>

          <ActionCard
            icon={User}
            title="Open a claim"
            hint="Must be sent by the coverage claimant. Binds one evidence hash to this coverage."
            disabled={!canWrite || busy}
            tx={txs.open}
            onSubmit={() => void onOpen()}
            submit="Open claim"
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Coverage id" htmlFor="open-coverage-id">
                <input id="open-coverage-id" style={inputStyle} value={openCoverageId} onChange={(e) => setOpenCoverageId(e.target.value)} inputMode="numeric" placeholder="1" />
              </Field>
              <Field label="Evidence note (hashed)" htmlFor="evidence-note">
                <input id="evidence-note" style={inputStyle} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} placeholder="Damage photos and receipt" />
              </Field>
            </div>
          </ActionCard>

          {operational ? (
            <div className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: "var(--color-inset)",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <Cpu size={18} color="var(--color-forest)" />
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>Evaluate and settle</div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
                    Only the claim claimant or coverage merchant can evaluate: you sign the evidence
                    fields with your wallet, the server verifies the signature against on-chain
                    ownership, runs the bounded policy, and returns a signed decision to relay.
                  </p>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Coverage id" htmlFor="eval-coverage-id">
                  <input id="eval-coverage-id" style={inputStyle} value={evalCoverageId} onChange={(e) => setEvalCoverageId(e.target.value)} inputMode="numeric" placeholder="1" />
                </Field>
                <Field label="Claim id" htmlFor="eval-claim-id">
                  <input id="eval-claim-id" style={inputStyle} value={evalClaimId} onChange={(e) => setEvalClaimId(e.target.value)} inputMode="numeric" placeholder="1" />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Requested amount (BOT)" htmlFor="requested-amt">
                  <input id="requested-amt" style={inputStyle} value={requestedAmt} onChange={(e) => setRequestedAmt(e.target.value)} inputMode="decimal" placeholder="0.001" />
                </Field>
                <Field label="Evidence note (must match the claim)" htmlFor="evidence-note-eval">
                  <input id="evidence-note-eval" style={inputStyle} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} placeholder="Damage photos and receipt" />
                </Field>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
                {(
                  [
                    ["damageEligible", "Damage eligible (self-attested)"],
                    ["evidenceComplete", "Evidence complete (self-attested)"],
                    ["fileIntegrityOk", "File integrity ok (self-attested)"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--color-muted)" }}>
                    <input
                      type="checkbox"
                      checked={signals[key]}
                      onChange={(e) => setSignals((s) => ({ ...s, [key]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
                <span style={{ fontSize: "0.78rem", color: "var(--color-muted-2)" }}>
                  Product/receipt match is derived server-side from the coverage&apos;s on-chain hashes.
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn btn-primary" onClick={() => void onAttestEvidence()} disabled={!canWrite || busy} style={{ padding: "0.6rem 1rem" }}>
                  {txs.evaluate.status === "pending" ? <Loader2 size={15} /> : null}
                  {evidenceAttested ? "Re-attest evidence" : "Attest evidence to server"}
                </button>
                <button className="btn btn-ghost" onClick={() => void onEvaluate()} disabled={!canWrite || busy || !evidenceAttested} style={{ padding: "0.6rem 1rem" }}>
                  {txs.evaluate.status === "pending" ? <Loader2 size={15} /> : null}
                  Evaluate
                </button>
                <button className="btn btn-ghost" onClick={() => void onResolve()} disabled={!canWrite || busy || !signed} style={{ padding: "0.6rem 1rem" }}>
                  {txs.resolve.status === "pending" ? <Loader2 size={15} /> : null}
                  Resolve with decision
                </button>
                {signed && <DecisionCard signed={signed} />}
              </div>
              <TxLine tx={txs.evaluate} />
              <TxLine tx={txs.resolve} />
            </div>
          ) : (
            <div className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: "var(--color-inset)",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <Cpu size={18} color="var(--color-forest)" />
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>Evaluate and settle</div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
                    Live read of claim #1 on BOT Chain Mainnet. This instance already settled. A new claim cannot be paid here because the evaluator signer was bound at deploy and is no longer in use.
                  </p>
                </div>
              </div>
              <dl
                style={{
                  margin: "16px 0 0",
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  columnGap: 16,
                  rowGap: 10,
                  fontSize: "0.95rem",
                }}
              >
                {(
                  [
                    ["Coverage id", "1"],
                    ["Claim id", "1"],
                    ["Paid", "0.001 BOT"],
                    ["Status", liveClaimLabel(claims)],
                    ["Nonce 1", instance.nonceUsed ? "Used" : "Open"],
                    ["Product matches", "Yes"],
                    ["Damage eligible", "Yes"],
                    ["Evidence complete", "Yes"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--color-muted)" }}>{k}</dt>
                    <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <a href="/proof" className="btn btn-primary" style={{ marginTop: 16 }}>
                Verify this payout live
              </a>
            </div>
          )}

          <ActionCard
            icon={Store}
            title="Withdraw free reserve"
            hint="Only free reserve can leave. Locked exposure stays until a claim is settled."
            disabled={!canWrite || busy}
            tx={txs.withdraw}
            onSubmit={() => void onWithdraw()}
            submit="Withdraw"
          >
            <Field label="Amount (BOT)" htmlFor="withdraw-amt">
              <input id="withdraw-amt" style={inputStyle} value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} inputMode="decimal" placeholder="0.005" />
            </Field>
          </ActionCard>
        </div>

        <div style={{ position: "sticky", top: 132, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <span className="kicker">Reserve, live</span>
              <span className="pill">
                <StatusDot tone={deployed && isConnected && onAppChain ? "ok" : "idle"} />
                {deployed ? (address ? shortAddr(address) : "no wallet") : "Not live yet"}
              </span>
            </div>
            <ReserveMeter
              balanceWei={isConnected ? reserve.balance : instance.balance}
              lockedWei={isConnected ? reserve.locked : instance.locked}
              freeWei={isConnected ? reserve.free : instance.free}
              caption={
                isConnected
                  ? "Read from reserveOf(connected wallet) on BOT Chain Mainnet."
                  : "Recorded merchant reserve on BOT Chain Mainnet. After reclaim this reads 0 / 0 / 0."
              }
            />
          </div>

          <div className="card" style={{ padding: 24 }}>
            <span className="kicker">Coverage and claims</span>
            {coverages.length === 0 ? (
              <p style={{ marginTop: 14, fontSize: "0.9rem", color: "var(--color-muted-2)" }}>
                {deployed ? "No coverage records yet." : "Live coverage will appear here once this workspace is on."}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {coverages.map((c) => {
                  const claim = claims.find((cl) => cl.id === c.claimId)
                  return (
                    <li key={String(c.id)} style={{ padding: "12px 14px", borderRadius: 13, background: "var(--color-inset)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <strong>Coverage #{String(c.id)}</strong>
                        <span style={{ fontSize: "0.78rem", color: "var(--color-muted-2)" }}>
                          {COVERAGE_STATUS[c.status] ?? c.status} · {formatBOT(c.maxPayout)} BOT
                        </span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--color-muted)" }}>
                        merchant {shortAddr(c.merchant)} · claimant {shortAddr(c.claimant)}
                      </div>
                      {claim && (
                        <div style={{ marginTop: 6, fontSize: "0.8rem" }}>
                          Claim #{String(claim.id)} · {CLAIM_STATUS[claim.status] ?? claim.status}
                          {claim.paidAmount > 0n ? ` · paid ${formatBOT(claim.paidAmount)}` : ""}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="kicker">Event log</span>
              <button className="btn btn-ghost" style={{ padding: "0.45rem 0.8rem", fontSize: "0.8rem" }} onClick={() => void onProbe()} disabled={!deployed || busy}>
                Test the guardrails
              </button>
            </div>
            {txs.probe.status !== "idle" && <TxLine tx={txs.probe} />}
            {log.length === 0 ? (
              <p style={{ marginTop: 14, fontSize: "0.9rem", color: "var(--color-muted-2)" }}>
                No events yet. Fund the reserve to start a live lifecycle.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {log.map((e) => (
                  <li key={e.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ marginTop: 5 }}>
                      <StatusDot tone={e.tone} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem", color: e.tone === "fail" ? "var(--color-fail)" : "var(--color-ink)" }}>
                        {e.event}
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--color-muted)", marginTop: 2 }}>{e.detail}</div>
                      {e.hash && (
                        <a className="link-teal" href={explorerTx(APP_CHAIN.id, e.hash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.78rem" }}>
                          {shortAddr(e.hash)}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .app-grid { grid-template-columns: 1fr !important; }
          .app-grid > div { position: static !important; }
        }
      `}</style>
    </section>
  )
}

function WalletButton({
  status,
  address,
  connecting,
  onConnect,
  onDisconnect,
}: {
  status: string
  address?: Address
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  if (status === "connected" && address) {
    return (
      <button className="btn btn-ghost" onClick={onDisconnect} style={{ padding: "0.6rem 1rem" }}>
        <Wallet size={15} />
        {shortAddr(address)}
      </button>
    )
  }
  return (
    <button className="btn btn-primary" onClick={onConnect} disabled={connecting} style={{ padding: "0.6rem 1rem" }}>
      {connecting ? <Loader2 size={15} /> : <Wallet size={15} />}
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  )
}

function ActionCard({
  icon: Icon,
  title,
  hint,
  children,
  disabled,
  tx,
  onSubmit,
  submit,
  extra,
}: {
  icon: typeof Landmark
  title: string
  hint: string
  children: React.ReactNode
  disabled: boolean
  tx: TxState
  onSubmit: () => void
  submit: string
  extra?: React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span
          style={{
            display: "inline-flex",
            width: 38,
            height: 38,
            borderRadius: 11,
            background: "var(--color-inset)",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon size={18} color="var(--color-forest)" />
        </span>
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: "var(--color-muted)", lineHeight: 1.5 }}>{hint}</p>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>{children}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={disabled || tx.status === "pending"}
          title={disabled ? "Connect a wallet on BOT Chain Mainnet to enable this" : undefined}
        >
          {tx.status === "pending" ? <Loader2 size={15} /> : null}
          {submit}
        </button>
        {extra}
      </div>
      <TxLine tx={tx} />
    </div>
  )
}

function ExampleCoverage() {
  const rows: [string, string][] = [
    ["Claimant", "0xAbf0…43e9"],
    ["Max payout", "0.001 BOT"],
    ["Expiry", "30 days"],
    ["Product", "Alpine kettle, batch A12"],
    ["Receipt", "Store ticket 1842"],
  ]
  return (
    <aside
      aria-label="Example coverage"
      style={{
        marginTop: 16,
        padding: "14px 16px",
        borderRadius: 14,
        background: "var(--color-inset)",
        border: "1px dashed var(--color-hairline)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div className="kicker" style={{ color: "var(--color-muted)" }}>
        Example
      </div>
      <p style={{ margin: "6px 0 10px", fontSize: "0.82rem", color: "var(--color-muted)", lineHeight: 1.45 }}>
        Sample figures so the form is not empty to the eye. Not live, not clickable.
      </p>
      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 14,
          rowGap: 6,
          fontSize: "0.88rem",
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--color-muted)" }}>{k}</dt>
            <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", marginTop: 10 }}>
      <span className="kicker" style={{ fontSize: "0.62rem", color: "var(--color-muted)" }}>
        {label}
      </span>
      <div style={{ marginTop: 6 }}>{children}</div>
    </label>
  )
}

function TxLine({ tx }: { tx: TxState }) {
  if (tx.status === "idle") return null
  const tone: Tone = tx.status === "confirmed" ? "ok" : tx.status === "failed" ? "fail" : "pending"
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
      <span style={{ marginTop: 4 }}>
        <StatusDot tone={tone} />
      </span>
      <div style={{ fontSize: "0.82rem", color: tx.status === "failed" ? "var(--color-fail)" : "var(--color-muted)" }}>
        <div>{tx.message || tx.status}</div>
        {tx.hash && (
          <a className="link-teal" href={explorerTx(APP_CHAIN.id, tx.hash)} target="_blank" rel="noopener noreferrer">
            {shortAddr(tx.hash)}
          </a>
        )}
      </div>
    </div>
  )
}

function DecisionCard({ signed }: { signed: SignedDecision }) {
  const rows: [string, string][] = [
    ["result", signed.model.decision],
    ["reason", signed.model.reasonCode],
    ["amount", `${formatBOT(signed.decision.amount)} BOT`],
    ["claimId", String(signed.decision.claimId)],
    ["coverageId", String(signed.decision.coverageId)],
    ["modelVersion", signed.model.modelVersion],
    ["signer", shortAddr(signed.signer)],
    ["signature", `${signed.signature.slice(0, 10)}…${signed.signature.slice(-6)}`],
  ]
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: "var(--color-inset)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Cpu size={15} color="var(--color-teal-ink)" />
        <span className="kicker">Signed decision</span>
      </div>
      <dl
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.8rem",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 6,
          columnGap: 14,
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--color-muted-2)" }}>{k}</dt>
            <dd
              style={{
                margin: 0,
                textAlign: "right",
                color: k === "result" && signed.model.decision === "APPROVE" ? "var(--color-teal-ink)" : "var(--color-ink)",
                fontWeight: k === "result" ? 600 : 400,
              }}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function summarizeEvent(name: string, args: Record<string, unknown>): string {
  if (name === "ReserveDeposited" || name === "ReserveWithdrawn") {
    return `${formatBOT(args.amount as bigint)} BOT · balance ${formatBOT(args.newBalance as bigint)}`
  }
  if (name === "CoverageIssued") {
    return `#${String(args.coverageId)} · lock ${formatBOT(args.maxPayout as bigint)} · claimant ${shortAddr(String(args.claimant))}`
  }
  if (name === "ClaimOpened") {
    return `claim #${String(args.claimId)} on coverage #${String(args.coverageId)}`
  }
  if (name === "ClaimPaid") {
    return `claim #${String(args.claimId)} paid ${formatBOT(args.amount as bigint)} BOT`
  }
  if (name === "ClaimRejected") {
    return `claim #${String(args.claimId)} rejected`
  }
  if (name === "CoverageExpired") {
    return `coverage #${String(args.coverageId)} expired · lock ${formatBOT(args.maxPayout as bigint)} released`
  }
  return Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .slice(0, 3)
    .map(([k, v]) => `${k} ${String(v).slice(0, 18)}`)
    .join(" · ")
}
