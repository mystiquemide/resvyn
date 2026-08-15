import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defineChain, numberToHex, parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildIsSponsorableRequest,
  checkSponsorable,
  parseSponsorResult,
  PaymasterError,
  sendSponsoredTransaction,
  type JsonRpcCaller,
} from "../scripts/paymaster.js";

// Unit tests for the BOT Chain EOA-paymaster client. No live chain and no live
// paymaster: the JSON-RPC transport is stubbed so we assert the exact request
// shapes and behaviour the doc specifies (pm_isSponsorable + zero-gas
// eth_sendRawTransaction). This is what makes the gasless path real code today
// even though no public chain-677 endpoint exists to run it against yet.

// A throwaway key. Test-only, never used on any live chain.
const TEST_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(TEST_KEY);

const chain = defineChain({
  id: 677,
  name: "BOT Chain (test)",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:0"] } },
});

const TO: Hex = "0x414592d2313d233b673b1f97803c261355ccd996";
const DATA: Hex = "0xdeadbeef";

// publicClient is only touched when nonce is omitted; tests pass an explicit
// nonce, so a bare stub is enough to satisfy the type.
const stubPublic = {} as never;

describe("paymaster: request building", () => {
  it("hex-encodes value and gas and defaults data to 0x", () => {
    const req = buildIsSponsorableRequest({ from: account.address, to: TO, gas: 100_000n });
    assert.equal(req.method, "pm_isSponsorable");
    assert.equal(req.jsonrpc, "2.0");
    const p = req.params[0];
    assert.equal(p.to, TO);
    assert.equal(p.from, account.address);
    assert.equal(p.gas, numberToHex(100_000n));
    assert.equal(p.value, "0x0");
    assert.equal(p.data, "0x");
  });

  it("carries through value and calldata when present", () => {
    const req = buildIsSponsorableRequest({
      from: account.address,
      to: TO,
      gas: 21_000n,
      value: 5n,
      data: DATA,
    });
    assert.equal(req.params[0].value, numberToHex(5n));
    assert.equal(req.params[0].data, DATA);
  });
});

describe("paymaster: result parsing", () => {
  it("reads the spec's capitalized fields", () => {
    const r = parseSponsorResult({ Sponsorable: true, SponsorPolicy: "resvyn-claims" });
    assert.equal(r.sponsorable, true);
    assert.equal(r.policy, "resvyn-claims");
  });

  it("treats a false or absent Sponsorable as not sponsorable", () => {
    assert.equal(parseSponsorResult({ Sponsorable: false }).sponsorable, false);
    assert.equal(parseSponsorResult({}).sponsorable, false);
    // A truthy-but-not-true value must not count as sponsorable.
    assert.equal(parseSponsorResult({ Sponsorable: "yes" }).sponsorable, false);
  });

  it("rejects a non-object result", () => {
    assert.throws(() => parseSponsorResult(null), PaymasterError);
    assert.throws(() => parseSponsorResult("nope"), PaymasterError);
  });
});

describe("paymaster: checkSponsorable", () => {
  it("invokes pm_isSponsorable and returns the parsed verdict", async () => {
    const seen: { method: string; params: unknown[] }[] = [];
    const call: JsonRpcCaller = async (method, params) => {
      seen.push({ method, params });
      return { Sponsorable: true, SponsorPolicy: "p1" };
    };
    const r = await checkSponsorable(call, { from: account.address, to: TO, gas: 90_000n });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "pm_isSponsorable");
    assert.equal(r.sponsorable, true);
    assert.equal(r.policy, "p1");
  });
});

describe("paymaster: sendSponsoredTransaction", () => {
  it("does not sign or broadcast when the paymaster declines", async () => {
    const methods: string[] = [];
    const call: JsonRpcCaller = async (method) => {
      methods.push(method);
      return { Sponsorable: false };
    };
    const out = await sendSponsoredTransaction({
      call,
      account,
      publicClient: stubPublic,
      chain,
      to: TO,
      data: DATA,
      gas: 165_620n,
      nonce: 3,
    });
    assert.equal(out.sponsored, false);
    assert.equal(out.hash, undefined);
    // Only the sponsorability probe ran; nothing was sent.
    assert.deepEqual(methods, ["pm_isSponsorable"]);
  });

  it("signs a zero-fee tx and submits it via eth_sendRawTransaction when sponsored", async () => {
    let submittedRaw: Hex | undefined;
    const call: JsonRpcCaller = async (method, params) => {
      if (method === "pm_isSponsorable") return { Sponsorable: true, SponsorPolicy: "resvyn" };
      if (method === "eth_sendRawTransaction") {
        submittedRaw = (params as Hex[])[0];
        return "0xabc123" as Hex;
      }
      throw new Error(`unexpected method ${method}`);
    };
    const out = await sendSponsoredTransaction({
      call,
      account,
      publicClient: stubPublic,
      chain,
      to: TO,
      data: DATA,
      gas: 165_620n,
      nonce: 7,
    });
    assert.equal(out.sponsored, true);
    assert.equal(out.policy, "resvyn");
    assert.equal(out.hash, "0xabc123");

    // The signed blob must actually carry zero gas fees and the right call.
    // viem RLP-decodes a zero fee field back as undefined (empty bytes), so
    // absent here means zero, which is exactly what we want.
    assert.ok(submittedRaw, "a raw tx should have been submitted");
    const decoded = parseTransaction(submittedRaw!);
    assert.equal(decoded.to, TO);
    assert.equal(decoded.data, DATA);
    assert.equal(decoded.nonce, 7);
    assert.equal(decoded.chainId, 677);
    assert.equal((decoded as { maxFeePerGas?: bigint }).maxFeePerGas ?? 0n, 0n);
    assert.equal((decoded as { maxPriorityFeePerGas?: bigint }).maxPriorityFeePerGas ?? 0n, 0n);
  });
});
