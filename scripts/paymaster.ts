import {
  numberToHex,
  parseTransaction,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";

// BOT Chain EOA Paymaster client (gasless-claim path).
//
// Implements the BOT Chain "EOA Paymaster" spec, which mirrors the BNB Chain /
// MegaFuel design: a paymaster is a SEPARATE JSON-RPC endpoint (never the main
// RPC) that exposes two methods:
//
//   pm_isSponsorable    -> { Sponsorable: bool, SponsorPolicy: string }
//   eth_sendRawTransaction (the wallet signs with gas price zeroed)
//
// Flow: the wallet asks pm_isSponsorable for a candidate call; if sponsorable it
// signs the SAME call with zero gas fees and submits the signed blob to the
// paymaster's eth_sendRawTransaction, which bundles it with a fee-paying sponsor
// tx. This fits Resvyn's openClaim exactly: openClaim enforces
// msg.sender == coverage.claimant, so the buyer's own EOA sends a zero-gas,
// sponsor-funded claim, no relayer, no smart-contract wallet.
//
// GATING: this module is inert unless the caller supplies a paymaster endpoint
// URL. As of 2026-08-10 no public chain-677 paymaster endpoint is published
// (main RPC returns -32601 for pm_* methods; docs name Nodereal MegaFuel, which
// covers BNB Chain only; no botchain paymaster host resolves publicly). So this
// is spec-correct integration code that activates the moment an endpoint exists.
// See docs: https://dev-docs.botchain.ai/docs/Developers/eoa-paymaster/

export class PaymasterError extends Error {}

// A minimal JSON-RPC caller so the transport is injectable (real fetch in prod,
// a stub in tests). Returns the decoded `result`, throws on transport / rpc error.
export type JsonRpcCaller = (method: string, params: unknown[]) => Promise<unknown>;

// The transaction shape pm_isSponsorable scores. All numeric fields are hex per
// the spec. `from` is the sender EOA, `to` the target contract.
export interface SponsorableTx {
  from: Hex;
  to: Hex;
  gas: bigint;
  value?: bigint;
  data?: Hex;
}

export interface SponsorResult {
  sponsorable: boolean;
  // The named policy the paymaster would apply. Present when sponsorable.
  policy?: string;
}

export interface SponsoredSendResult {
  // true only if the paymaster accepted and broadcast the zero-gas tx.
  sponsored: boolean;
  policy?: string;
  // The tx hash returned by the paymaster's eth_sendRawTransaction. Absent when
  // not sponsorable (caller should fall back to a normal, self-paid send).
  hash?: Hex;
}

// Build the exact pm_isSponsorable JSON-RPC request body from a candidate tx.
// Hex-encodes value/gas and defaults data to "0x", matching the doc's params
// schema: [{ to, from, value, data, gas }].
export function buildIsSponsorableRequest(tx: SponsorableTx, id = 1) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "pm_isSponsorable" as const,
    params: [
      {
        to: tx.to,
        from: tx.from,
        value: numberToHex(tx.value ?? 0n),
        data: tx.data ?? ("0x" as Hex),
        gas: numberToHex(tx.gas),
      },
    ],
  };
}

// Parse a pm_isSponsorable `result`. The spec capitalizes the fields
// (Sponsorable / SponsorPolicy); we read those and nothing else.
export function parseSponsorResult(result: unknown): SponsorResult {
  if (result == null || typeof result !== "object") {
    throw new PaymasterError("pm_isSponsorable returned a non-object result");
  }
  const r = result as Record<string, unknown>;
  const sponsorable = r.Sponsorable === true;
  const policy = typeof r.SponsorPolicy === "string" ? r.SponsorPolicy : undefined;
  return { sponsorable, policy };
}

// Ask the paymaster whether it will sponsor `tx`.
export async function checkSponsorable(
  call: JsonRpcCaller,
  tx: SponsorableTx,
): Promise<SponsorResult> {
  const req = buildIsSponsorableRequest(tx);
  const result = await call(req.method, req.params);
  return parseSponsorResult(result);
}

// A JSON-RPC caller backed by global fetch. Points at the paymaster endpoint,
// which MUST be distinct from the main chain RPC.
export function httpJsonRpcCaller(url: string): JsonRpcCaller {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) {
      throw new PaymasterError(`paymaster HTTP ${res.status} calling ${method}`);
    }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) {
      throw new PaymasterError(
        `paymaster ${method} error: ${body.error.message ?? JSON.stringify(body.error)}`,
      );
    }
    return body.result;
  };
}

export interface SendSponsoredParams {
  call: JsonRpcCaller;
  account: Account;
  publicClient: PublicClient;
  chain: Chain;
  to: Hex;
  data: Hex;
  gas: bigint;
  value?: bigint;
  // Nonce override; fetched from the main RPC when omitted.
  nonce?: number;
}

// Full gasless send: check sponsorability, and if granted, sign the call with
// zero gas fees and hand the signed blob to the paymaster's
// eth_sendRawTransaction. Returns { sponsored: false } (no hash) when the
// paymaster declines, so the caller can fall back to a normal self-paid send.
//
// The signed tx is EIP-1559 with maxFeePerGas = maxPriorityFeePerGas = 0. BOT
// Chain pins baseFeePerGas at 0, so a zero-fee 1559 tx is a valid zero-gas-price
// tx; the paymaster supplies the fee-paying half of the bundle.
export async function sendSponsoredTransaction(
  params: SendSponsoredParams,
): Promise<SponsoredSendResult> {
  const { call, account, publicClient, chain, to, data, gas, value } = params;

  const sponsor = await checkSponsorable(call, {
    from: account.address,
    to,
    gas,
    value,
    data,
  });
  if (!sponsor.sponsorable) {
    return { sponsored: false, policy: sponsor.policy };
  }

  const nonce =
    params.nonce ??
    (await publicClient.getTransactionCount({ address: account.address }));

  if (!account.signTransaction) {
    throw new PaymasterError(
      "account cannot sign transactions locally (needs a local/private-key account)",
    );
  }
  const signed = await account.signTransaction({
    chainId: chain.id,
    nonce,
    to,
    data,
    value: value ?? 0n,
    gas,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
  });

  // Sanity: never let a non-zero fee slip through to the paymaster. viem
  // RLP-decodes a zero fee field back as undefined (empty bytes), so treat
  // absent as zero and reject any concrete non-zero fee.
  const decoded = parseTransaction(signed) as {
    maxFeePerGas?: bigint;
    gasPrice?: bigint;
  };
  const fee = decoded.maxFeePerGas ?? decoded.gasPrice ?? 0n;
  if (fee !== 0n) {
    throw new PaymasterError("refusing to submit a sponsored tx with non-zero gas price");
  }

  const hash = (await call("eth_sendRawTransaction", [signed])) as Hex;
  return { sponsored: true, policy: sponsor.policy, hash };
}
