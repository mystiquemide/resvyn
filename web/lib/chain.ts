import { defineChain } from "viem"

/* ------------------------------------------------------------------ *
 * Networks
 * ------------------------------------------------------------------ */

/** BOT Chain Mainnet. Home of the current deployment and recorded lifecycle proof. */
export const botMainnet = defineChain({
  id: 677,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.botchain.ai"] } },
  blockExplorers: {
    default: { name: "BOTScan", url: "https://scan.botchain.ai" },
  },
})

/** BOT Chain Testnet (Bohr). Kept only so explorer helpers can still decode old 968 links. */
export const botTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  testnet: true,
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_BOT_TESTNET_RPC_URL || "https://rpc.bohr.life",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Bohr Explorer",
      url: process.env.NEXT_PUBLIC_BOT_TESTNET_EXPLORER || "https://scan.bohr.life",
    },
  },
})

/** The chain /app writes against. BOT Chain Mainnet, chain 677. */
export const APP_CHAIN = botMainnet

/** True only when /app has a real 20-byte Mainnet address to write against. */
export function isAppContractReady(
  addr: string,
): addr is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

export function explorerTx(chainId: number, hash: string): string {
  const base = chainId === 677 ? botMainnet.blockExplorers.default.url : botTestnet.blockExplorers.default.url
  return `${base}/tx/${hash}`
}
export function explorerAddress(chainId: number, addr: string): string {
  const base = chainId === 677 ? botMainnet.blockExplorers.default.url : botTestnet.blockExplorers.default.url
  return `${base}/address/${addr}`
}

/* ------------------------------------------------------------------ *
 * EIP-712 signed claim decision (matches contract BR-008 field order)
 * ------------------------------------------------------------------ */

export const EIP712_DOMAIN_NAME = "Resvyn Warranty Reserve"
export const EIP712_DOMAIN_VERSION = "1"

export const CLAIM_DECISION_TYPES = {
  ClaimDecision: [
    { name: "chainId", type: "uint256" },
    { name: "verifier", type: "address" },
    { name: "claimId", type: "uint256" },
    { name: "coverageId", type: "uint256" },
    { name: "claimant", type: "address" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "result", type: "uint8" },
    { name: "modelVersion", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const

export function claimDecisionDomain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const
}

/* ------------------------------------------------------------------ *
 * Contract ABI (focused: only what the app calls)
 * ------------------------------------------------------------------ */

export const warrantyReserveAbi = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "evaluatorSigner_", type: "address" }] },

  { type: "function", name: "depositReserve", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "issueCoverage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimant", type: "address" },
      { name: "productHash", type: "bytes32" },
      { name: "receiptHash", type: "bytes32" },
      { name: "maxPayout", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "openClaim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "coverageId", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "resolveClaim",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "d",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "verifier", type: "address" },
          { name: "claimId", type: "uint256" },
          { name: "coverageId", type: "uint256" },
          { name: "claimant", type: "address" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "result", type: "uint8" },
          { name: "modelVersion", type: "bytes32" },
          { name: "expiry", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "expireCoverage",
    stateMutability: "nonpayable",
    inputs: [{ name: "coverageId", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "withdrawReserve", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },

  {
    type: "function",
    name: "reserveOf",
    stateMutability: "view",
    inputs: [{ name: "merchant", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "locked", type: "uint256" },
      { name: "free", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "coverageOf",
    stateMutability: "view",
    inputs: [{ name: "coverageId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "merchant", type: "address" },
          { name: "claimant", type: "address" },
          { name: "productHash", type: "bytes32" },
          { name: "receiptHash", type: "bytes32" },
          { name: "maxPayout", type: "uint256" },
          { name: "expiry", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "claimOf",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "coverageId", type: "uint256" },
          { name: "claimant", type: "address" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "paidAmount", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "openedAt", type: "uint64" },
        ],
      },
    ],
  },
  { type: "function", name: "coverageCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "claimCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "claimIdOfCoverage", stateMutability: "view", inputs: [{ name: "coverageId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isNonceUsed", stateMutability: "view", inputs: [{ name: "nonce", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "evaluatorSigner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },

  { type: "event", name: "ReserveDeposited", inputs: [{ name: "merchant", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "newBalance", type: "uint256", indexed: false }] },
  { type: "event", name: "CoverageIssued", inputs: [{ name: "coverageId", type: "uint256", indexed: true }, { name: "merchant", type: "address", indexed: true }, { name: "claimant", type: "address", indexed: true }, { name: "maxPayout", type: "uint256", indexed: false }, { name: "expiry", type: "uint64", indexed: false }] },
  { type: "event", name: "ClaimOpened", inputs: [{ name: "claimId", type: "uint256", indexed: true }, { name: "coverageId", type: "uint256", indexed: true }, { name: "claimant", type: "address", indexed: true }, { name: "evidenceHash", type: "bytes32", indexed: false }] },
  { type: "event", name: "ClaimPaid", inputs: [{ name: "claimId", type: "uint256", indexed: true }, { name: "coverageId", type: "uint256", indexed: true }, { name: "claimant", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "modelVersion", type: "bytes32", indexed: false }, { name: "nonce", type: "uint256", indexed: false }] },
  { type: "event", name: "ClaimRejected", inputs: [{ name: "claimId", type: "uint256", indexed: true }, { name: "coverageId", type: "uint256", indexed: true }, { name: "claimant", type: "address", indexed: true }, { name: "modelVersion", type: "bytes32", indexed: false }, { name: "nonce", type: "uint256", indexed: false }] },
  { type: "event", name: "ReserveWithdrawn", inputs: [{ name: "merchant", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "newBalance", type: "uint256", indexed: false }] },
  { type: "event", name: "CoverageExpired", inputs: [{ name: "coverageId", type: "uint256", indexed: true }, { name: "merchant", type: "address", indexed: true }, { name: "maxPayout", type: "uint256", indexed: false }, { name: "expiry", type: "uint64", indexed: false }] },

  { type: "error", name: "InsufficientFreeReserve", inputs: [{ name: "freeReserve", type: "uint256" }, { name: "requested", type: "uint256" }] },
  { type: "error", name: "WithdrawalExceedsFreeReserve", inputs: [{ name: "freeReserve", type: "uint256" }, { name: "requested", type: "uint256" }] },
  { type: "error", name: "NonceAlreadyUsed", inputs: [] },
  { type: "error", name: "InvalidSigner", inputs: [] },
  { type: "error", name: "CoverageNotActive", inputs: [] },
  { type: "error", name: "ClaimAlreadyExists", inputs: [] },
  { type: "error", name: "ClaimNotOpen", inputs: [] },
  { type: "error", name: "NotClaimant", inputs: [] },
  { type: "error", name: "ZeroDeposit", inputs: [] },
  { type: "error", name: "ZeroWithdrawal", inputs: [] },
  { type: "error", name: "ZeroMaxPayout", inputs: [] },
  { type: "error", name: "InvalidClaimant", inputs: [] },
  { type: "error", name: "InvalidExpiry", inputs: [] },
  { type: "error", name: "CoverageAlreadyExpired", inputs: [] },
  { type: "error", name: "CoverageNotExpired", inputs: [] },
  { type: "error", name: "WithdrawalTransferFailed", inputs: [] },
  { type: "error", name: "ZeroEvaluatorSigner", inputs: [] },
  { type: "error", name: "ZeroEvidenceHash", inputs: [] },
  { type: "error", name: "WrongChain", inputs: [] },
  { type: "error", name: "WrongVerifier", inputs: [] },
  { type: "error", name: "DecisionExpired", inputs: [] },
  { type: "error", name: "ClaimAlreadyFinalized", inputs: [] },
  { type: "error", name: "CoverageMismatch", inputs: [] },
  { type: "error", name: "ClaimantMismatch", inputs: [] },
  { type: "error", name: "EvidenceMismatch", inputs: [] },
  { type: "error", name: "AmountOutOfRange", inputs: [] },
  { type: "error", name: "InvalidResult", inputs: [] },
  { type: "error", name: "PayoutTransferFailed", inputs: [] },
] as const

export const MAINNET_CHAIN_ID = 677

/* ------------------------------------------------------------------ *
 * Current hardened Mainnet deployment
 * ------------------------------------------------------------------ */

export const CURRENT_DEPLOYMENT = {
  chainId: MAINNET_CHAIN_ID,
  contract: "0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe" as `0x${string}`,
  evaluator: "0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0" as `0x${string}`,
  deployTx: "0x600b3cd1dee4d87aa4845106673724630be60408b108348ad9c4c3b894e75a49" as `0x${string}`,
  deploymentBlock: 19898630n,
  smokeReserveWei: 1000000000000000n, // 0.001 BOT
} as const

/**
 * /app reads and writes against the current hardened Mainnet deployment by
 * default. The live on-chain evaluator signer still has to match the current
 * deployment manifest before any write control becomes available.
 */
export const APP_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_RESVYN_ADDRESS ||
  CURRENT_DEPLOYMENT.contract) as `0x${string}`

/** First block /app needs to scan for the configured deployment's events. */
export const DEPLOY_START_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_DEPLOY_START_BLOCK || CURRENT_DEPLOYMENT.deploymentBlock.toString(),
)

/* ------------------------------------------------------------------ *
 * Archived full-lifecycle Mainnet proof (CP-011)
 * ------------------------------------------------------------------ */

export const PROOF = {
  chainId: 677,
  contract: "0x414592d2313d233b673b1f97803c261355ccd996" as `0x${string}`,
  merchant: "0x50498a61d20CBFa19A74c2D46302a6C0F41f1720" as `0x${string}`,
  buyer: "0xAbf039f2DC31084F5E0713708C96068126a043e9" as `0x${string}`,
  evaluator: "0xb1CB08A7f81c0722941ACaDD1eC3E521358a455E" as `0x${string}`,
  runtimeBytes: 12756,
  maxPayoutWei: 1000000000000000n, // 0.001 BOT
  deposited: "0.005",
  locked: "0.001",
  paid: "0.001",
  withdrawn: "0.004",
  selectors: {
    reserveOf: "0x9fa77b20",
    coverageOf: "0x263a268d",
    claimOf: "0x11c8dc5a",
    coverageCount: "0xc1299f37",
    claimCount: "0x8da4d3c9",
    claimIdOfCoverage: "0x99a6b1c1",
    isNonceUsed: "0x5d00bb12",
    evaluatorSigner: "0x90996799",
    issueCoverage: "0x6a19fe9e",
  },
  errInsufficientFree: "0x57532ab3", // InsufficientFreeReserve(uint256,uint256)
  eventTopic: {
    ReserveDeposited: "0x9705a8ff16374359785d31b0f1862c27f983645496f40760d180a9830eeaf2e8",
    CoverageIssued: "0x55e81e11b5d9bf9c5bfec5aaa351368d946ebf25be078e1e95bff2d84d74e94a",
    ClaimOpened: "0xd3e62784b132b977734bb48762e80185eabd54bb35f7c02a197c8488d9026a0e",
    ClaimPaid: "0x9bdc6ad69fb4d6754396a9c5f8f6a3c7055af8b049dcdee78bc3aa13b9e65a6a",
    ReserveWithdrawn: "0xf7aeb382a1e87f84aa69637a22868c2e12be1261273f04cdf40a262a8b890031",
  },
  txs: [
    { key: "deploy", step: "Deploy WarrantyReserve", who: "merchant", value: "", block: 19219910n, gas: 2855243n, event: null as string | null, hash: "0x36f9232b63513673eaac2264e59fcfa9025075a756a974d265a545399815d84f" },
    { key: "deposit", step: "Deposit reserve", who: "merchant", value: "0.005 BOT", block: 19219912n, gas: 45804n, event: "ReserveDeposited", hash: "0x9939c6babadba6caef5c5fd24847c2cc137f0e35372b4fbf7d5dd6ce93d8da32" },
    { key: "issue", step: "Issue coverage #1 (lock 0.001)", who: "merchant", value: "", block: 19219914n, gas: 207758n, event: "CoverageIssued", hash: "0xb3b558ca3b91574bf960c1b809675a16d03d35b6e1113bf6b10cb6c371ff3919" },
    { key: "openClaim", step: "Open claim #1", who: "buyer", value: "", block: 19219917n, gas: 165620n, event: "ClaimOpened", hash: "0x117848f679bca29d3ec5ce39ed3e246453b990accf419c8a61a02cc22735aa40" },
    { key: "resolve", step: "Resolve: evaluator-signed approve and pay", who: "merchant", value: "0.001 BOT to buyer", block: 19219919n, gas: 117884n, event: "ClaimPaid", hash: "0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d" },
    { key: "withdraw", step: "Withdraw free reserve", who: "merchant", value: "0.004 BOT reclaimed", block: 19219923n, gas: 33990n, event: "ReserveWithdrawn", hash: "0x0a94e8fe5c9496b1d0a943886a33e00fd83ec9037ff76ef19e3da7422f07b01e" },
  ],
} as const

export const MAINNET_RPC = "https://rpc.botchain.ai"

/* ------------------------------------------------------------------ *
 * REV-002: deployment manifest gate
 * ------------------------------------------------------------------ */

/**
 * The archived proof instance is permanently read-only.
 *
 * The current hardened deployment is operational by default because its
 * contract and immutable evaluator are part of this checked-in manifest. An
 * operator can still force it read-only by setting NEXT_PUBLIC_RESVYN_OPERATIONAL=0.
 *
 * Any custom non-archived deployment continues to require BOTH:
 *   - NEXT_PUBLIC_RESVYN_OPERATIONAL=1, AND
 *   - an explicit NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR pin.
 *
 * In every operational case AppConsole independently reads evaluatorSigner()
 * from chain and enables writes only when that live signer matches the expected
 * evaluator below.
 */
export const ARCHIVED_PROOF_ADDRESS = PROOF.contract

export function isArchivedProofInstance(addr: string): boolean {
  return addr.toLowerCase() === ARCHIVED_PROOF_ADDRESS.toLowerCase()
}

export function isCurrentDeployment(addr: string = APP_CONTRACT_ADDRESS): boolean {
  return addr.toLowerCase() === CURRENT_DEPLOYMENT.contract.toLowerCase()
}

export function isOperationalDeployment(addr: string = APP_CONTRACT_ADDRESS): boolean {
  if (isArchivedProofInstance(addr)) return false

  if (isCurrentDeployment(addr)) {
    return process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL !== "0"
  }

  return (
    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL === "1" &&
    Boolean(process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR)
  )
}

/**
 * Client-side evaluator manifest gate. The current deployment falls back to
 * its checked-in immutable evaluator address. Custom deployments still need
 * NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR. The live signer must match this value
 * before AppConsole exposes any write action. The server independently checks
 * its protected RESVYN_EVALUATOR_KEY against evaluatorSigner() before signing.
 */
export const EXPECTED_EVALUATOR = (
  process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR ||
  (isCurrentDeployment(APP_CONTRACT_ADDRESS) ? CURRENT_DEPLOYMENT.evaluator : undefined)
)?.toLowerCase()

export function evaluatorSignerMatches(expected: string | undefined, live: string | undefined): boolean {
  if (!expected) return false
  if (!live) return false
  return expected === live.toLowerCase()
}