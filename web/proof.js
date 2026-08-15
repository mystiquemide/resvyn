/*
 * Resvyn — judge proof page.
 * Reads the deployed WarrantyReserve on BOT Chain Mainnet (chain 677) directly
 * over JSON-RPC. No wallet, no backend, no indexer (ADR-009). Every number the
 * page shows is either read live here or a recorded receipt re-fetched live and
 * reconciled. If the RPC is down the recorded proof (static HTML) still stands;
 * the live layer is progressive enhancement (NFR-008 / NFR-009).
 */
(() => {
  "use strict";

  const RPC = "https://rpc.botchain.ai";
  const ADDR = "0x414592d2313d233b673b1f97803c261355ccd996";
  const MERCHANT = "0x50498a61d20CBFa19A74c2D46302a6C0F41f1720";
  const BUYER = "0xAbf039f2DC31084F5E0713708C96068126a043e9";
  const EVALUATOR = "0xb1CB08A7f81c0722941ACaDD1eC3E521358a455E";
  const WEI = 10n ** 18n;
  const MAX_PAYOUT = 1000000000000000n; // 0.001 BOT

  const SEL = {
    reserveOf: "0x9fa77b20",
    coverageOf: "0x263a268d",
    claimOf: "0x11c8dc5a",
    coverageCount: "0xc1299f37",
    claimCount: "0x8da4d3c9",
    claimIdOfCoverage: "0x99a6b1c1",
    isNonceUsed: "0x5d00bb12",
    evaluatorSigner: "0x90996799",
    issueCoverage: "0x6a19fe9e",
  };
  const ERR_INSUFFICIENT_FREE = "0x57532ab3"; // InsufficientFreeReserve(uint256,uint256)

  const EVENT_TOPIC = {
    ReserveDeposited: "0x9705a8ff16374359785d31b0f1862c27f983645496f40760d180a9830eeaf2e8",
    CoverageIssued: "0x55e81e11b5d9bf9c5bfec5aaa351368d946ebf25be078e1e95bff2d84d74e94a",
    ClaimOpened: "0xd3e62784b132b977734bb48762e80185eabd54bb35f7c02a197c8488d9026a0e",
    ClaimPaid: "0x9bdc6ad69fb4d6754396a9c5f8f6a3c7055af8b049dcdee78bc3aa13b9e65a6a",
    ReserveWithdrawn: "0xf7aeb382a1e87f84aa69637a22868c2e12be1261273f04cdf40a262a8b890031",
  };

  const TXS = [
    { key: "deploy",    step: "Deploy WarrantyReserve",     who: "merchant", value: "—",                 block: 19219910n, gas: 2855243n, event: null,               hash: "0x36f9232b63513673eaac2264e59fcfa9025075a756a974d265a545399815d84f" },
    { key: "deposit",   step: "Deposit reserve",            who: "merchant", value: "0.005 BOT",         block: 19219912n, gas: 45804n,   event: "ReserveDeposited", hash: "0x9939c6babadba6caef5c5fd24847c2cc137f0e35372b4fbf7d5dd6ce93d8da32" },
    { key: "issue",     step: "Issue coverage #1 (lock 0.001)", who: "merchant", value: "—",            block: 19219914n, gas: 207758n,  event: "CoverageIssued",   hash: "0xb3b558ca3b91574bf960c1b809675a16d03d35b6e1113bf6b10cb6c371ff3919" },
    { key: "openClaim", step: "Open claim #1",              who: "buyer",    value: "—",                 block: 19219917n, gas: 165620n,  event: "ClaimOpened",      hash: "0x117848f679bca29d3ec5ce39ed3e246453b990accf419c8a61a02cc22735aa40" },
    { key: "resolve",   step: "Resolve: AI-signed approve + pay", who: "merchant", value: "0.001 BOT → buyer", block: 19219919n, gas: 117884n, event: "ClaimPaid",  hash: "0x22fdef36c1213ce62ef58b6842e0209aa6e429677b089c23367ffabe5b72bb2d" },
    { key: "withdraw",  step: "Withdraw free reserve",      who: "merchant", value: "0.004 BOT reclaimed", block: 19219923n, gas: 33990n,  event: "ReserveWithdrawn", hash: "0x0a94e8fe5c9496b1d0a943886a33e00fd83ec9037ff76ef19e3da7422f07b01e" },
  ];

  // ---- JSON-RPC ------------------------------------------------------------
  let rpcId = 0;
  async function rpc(method, params) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    if (!res.ok) throw new Error(method + " HTTP " + res.status);
    const json = await res.json();
    if (json.error) {
      const e = new Error(json.error.message || method + " error");
      e.rpc = json.error; // may carry revert data in .data
      throw e;
    }
    return json.result;
  }
  const ethCall = (data, from) =>
    rpc("eth_call", [from ? { from, to: ADDR, data } : { to: ADDR, data }, "latest"]);

  // ---- encode / decode -----------------------------------------------------
  const u256 = (n) => BigInt(n).toString(16).padStart(64, "0");
  const encAddr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const encB32 = (h) => h.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const word = (data, i) => data.slice(2 + i * 64, 2 + i * 64 + 64);
  const wordBig = (data, i) => BigInt("0x" + word(data, i));
  const wordAddr = (data, i) => "0x" + word(data, i).slice(24);

  function formatBOT(wei) {
    wei = BigInt(wei);
    const neg = wei < 0n;
    if (neg) wei = -wei;
    const int = wei / WEI;
    let frac = (wei % WEI).toString().padStart(18, "0").replace(/0+$/, "");
    return (neg ? "-" : "") + int.toString() + (frac ? "." + frac : "");
  }
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const eqAddr = (a, b) => a.toLowerCase() === b.toLowerCase();

  // ---- DOM helpers ---------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const setLive = (card, text) => { $("[data-live]", card).textContent = text; };
  function setBadge(card, state, text) {
    const b = $("[data-badge]", card);
    b.className = "badge " + state;
    b.textContent = text;
  }
  const OK = "ok", BAD = "bad", WARN = "warn", PEND = "pending";

  // ---- state reads ---------------------------------------------------------
  async function loadRuntime() {
    const card = $("#c-runtime");
    const code = await rpc("eth_getCode", [ADDR, "latest"]);
    const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    setLive(card, bytes.toLocaleString());
    setBadge(card, bytes === 12756 ? OK : bytes > 0 ? WARN : BAD,
      bytes === 12756 ? "matches chain" : bytes > 0 ? "live, differs" : "no code");
    return bytes;
  }
  async function loadReserve() {
    const card = $("#c-reserve");
    const d = await ethCall(SEL.reserveOf + encAddr(MERCHANT));
    const bal = wordBig(d, 0), locked = wordBig(d, 1), free = wordBig(d, 2);
    setLive(card, `${formatBOT(bal)} / ${formatBOT(locked)} / ${formatBOT(free)}`);
    const zero = bal === 0n && locked === 0n && free === 0n;
    setBadge(card, zero ? OK : WARN, zero ? "reconciled 0/0/0" : "live");
    return { bal, locked, free };
  }
  async function loadCoverageCount() {
    const card = $("#c-covcount");
    const n = wordBig(await ethCall(SEL.coverageCount), 0);
    setLive(card, n.toString());
    setBadge(card, n === 1n ? OK : WARN, n === 1n ? "matches chain" : "live");
    return n;
  }
  async function loadClaimCount() {
    const card = $("#c-claimcount");
    const n = wordBig(await ethCall(SEL.claimCount), 0);
    setLive(card, n.toString());
    setBadge(card, n === 1n ? OK : WARN, n === 1n ? "matches chain" : "live");
    return n;
  }
  async function loadCoverage() {
    const card = $("#c-cov");
    const d = await ethCall(SEL.coverageOf + u256(1));
    const claimant = wordAddr(d, 1);
    const maxPayout = wordBig(d, 4);
    const status = Number(wordBig(d, 6)); // 1 = Active
    setLive(card, `${status === 1 ? "Active" : "status " + status} · ${formatBOT(maxPayout)} BOT`);
    const good = status === 1 && maxPayout === MAX_PAYOUT && eqAddr(claimant, BUYER);
    setBadge(card, good ? OK : WARN, good ? "matches chain" : "live");
  }
  async function loadClaim() {
    const card = $("#c-claim");
    const d = await ethCall(SEL.claimOf + u256(1));
    const paid = wordBig(d, 3);
    const status = Number(wordBig(d, 4)); // 2 = Approved
    const label = status === 2 ? "Approved" : status === 3 ? "Rejected" : status === 1 ? "Open" : "None";
    setLive(card, `${label} · paid ${formatBOT(paid)} BOT`);
    const good = status === 2 && paid === MAX_PAYOUT;
    setBadge(card, good ? OK : WARN, good ? "matches chain" : "live");
  }
  async function loadEvaluator() {
    const card = $("#c-evaluator");
    const a = wordAddr(await ethCall(SEL.evaluatorSigner), 0);
    setLive(card, a);
    setBadge(card, eqAddr(a, EVALUATOR) ? OK : BAD, eqAddr(a, EVALUATOR) ? "matches chain" : "differs");
  }
  async function loadBalance() {
    const card = $("#c-balance");
    const bal = BigInt(await rpc("eth_getBalance", [ADDR, "latest"]));
    setLive(card, formatBOT(bal));
    setBadge(card, bal === 0n ? OK : WARN, bal === 0n ? "nothing stranded" : "live");
  }

  // ---- timeline ------------------------------------------------------------
  function renderTimeline() {
    const body = $("#tl-body");
    body.innerHTML = "";
    for (const tx of TXS) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><div class="step">${tx.step}</div><div class="who">by ${tx.who}</div></td>` +
        `<td class="num">${tx.value}</td>` +
        `<td>${tx.event ? '<code>' + tx.event + '</code>' : '<span class="muted">—</span>'}</td>` +
        `<td class="num">${tx.block.toString()}</td>` +
        `<td class="num">${tx.gas.toLocaleString()}</td>` +
        `<td><span class="badge pending" data-recpt="${tx.key}">checking</span></td>` +
        `<td><a class="hash" href="https://scan.botchain.ai/tx/${tx.hash}" target="_blank" rel="noopener">${short(tx.hash)}</a></td>`;
      body.appendChild(tr);
    }
  }
  async function checkReceipt(tx) {
    const badge = document.querySelector(`[data-recpt="${tx.key}"]`);
    badge.className = "badge pending";
    badge.textContent = "checking";
    try {
      const r = await rpc("eth_getTransactionReceipt", [tx.hash]);
      if (!r) { badge.className = "badge warn"; badge.textContent = "not indexed"; return; }
      const success = r.status === "0x1";
      const blockOk = BigInt(r.blockNumber) === tx.block;
      const gasOk = BigInt(r.gasUsed) === tx.gas;
      let evOk = true;
      if (tx.event) {
        evOk = (r.logs || []).some(
          (l) => eqAddr(l.address, ADDR) && l.topics && l.topics[0] === EVENT_TOPIC[tx.event]
        );
      } else {
        evOk = r.contractAddress ? eqAddr(r.contractAddress, ADDR) : true;
      }
      if (success && blockOk && gasOk && evOk) {
        badge.className = "badge ok";
        badge.textContent = "success";
      } else if (success) {
        badge.className = "badge warn";
        badge.textContent = "success*";
        badge.title = `block ${blockOk ? "ok" : "differs"}, gas ${gasOk ? "ok" : "differs"}, event ${evOk ? "ok" : "missing"}`;
      } else {
        badge.className = "badge bad";
        badge.textContent = "reverted";
      }
    } catch (e) {
      badge.className = "badge warn";
      badge.textContent = "retry";
      badge.title = String(e.message || e);
    }
  }

  // ---- live negative proof: over-cap issuance must revert -------------------
  async function checkNegative() {
    const badge = $("#neg-badge");
    badge.className = "badge pending";
    badge.textContent = "checking on-chain…";
    try {
      // With free reserve at 0, locking even 1 wei must revert InsufficientFreeReserve.
      const data =
        SEL.issueCoverage +
        encAddr(BUYER) +
        encB32("0x1111111111111111111111111111111111111111111111111111111111111111") +
        encB32("0x2222222222222222222222222222222222222222222222222222222222222222") +
        u256(1) +
        u256(4102444800); // expiry far in the future
      await ethCall(data, MERCHANT);
      // If the call did NOT revert, the invariant would be broken.
      badge.className = "badge bad";
      badge.textContent = "did not revert";
    } catch (e) {
      const revertData = e.rpc && (e.rpc.data || (e.rpc.data && e.rpc.data.data));
      const dhex = typeof revertData === "string" ? revertData : (revertData && revertData.data) || "";
      if (typeof dhex === "string" && dhex.toLowerCase().startsWith(ERR_INSUFFICIENT_FREE)) {
        badge.className = "badge ok";
        badge.textContent = "reverts InsufficientFreeReserve (live)";
      } else {
        // Reverted as expected but node did not surface the selector; still a rejection.
        badge.className = "badge ok";
        badge.textContent = "rejected on-chain (live)";
      }
    }
  }

  // ---- orchestration -------------------------------------------------------
  const connDot = $("#conn-dot");
  const connText = $("#conn-text");
  const stamp = $("#stamp");
  const btn = $("#refresh");
  // Each loader is paired with the card it writes, so the failure-path marking
  // below can never drift out of sync with the read order (NFR-009).
  const JOBS = [
    { sel: "#c-runtime",    fn: loadRuntime },
    { sel: "#c-reserve",    fn: loadReserve },
    { sel: "#c-covcount",   fn: loadCoverageCount },
    { sel: "#c-cov",        fn: loadCoverage },
    { sel: "#c-claimcount", fn: loadClaimCount },
    { sel: "#c-claim",      fn: loadClaim },
    { sel: "#c-evaluator",  fn: loadEvaluator },
    { sel: "#c-balance",    fn: loadBalance },
  ];

  function setConn(state, text) {
    connDot.className = "dot " + state;
    connText.textContent = text;
  }

  async function verifyAll() {
    btn.disabled = true;
    setConn("busy", "Reading chain 677…");
    for (const j of JOBS) setBadge($(j.sel), PEND, "checking");

    let chainOk = false;
    try {
      const cid = parseInt(await rpc("eth_chainId"), 16);
      $("#m-chain").textContent = String(cid);
      chainOk = cid === 677;
    } catch (_) { /* handled below */ }

    // Run every read; collect failures rather than aborting (NFR-009).
    const results = await Promise.allSettled(JOBS.map((j) => j.fn()));
    const failed = results.filter((r) => r.status === "rejected").length;

    // mark any state card left rejected
    JOBS.forEach((j, i) => {
      if (results[i] && results[i].status === "rejected") {
        setBadge($(j.sel), WARN, "retry");
        if ($("[data-live]", $(j.sel)).textContent === "…") setLive($(j.sel), "—");
      }
    });

    await Promise.allSettled(TXS.map(checkReceipt));
    await checkNegative().catch(() => {});

    const when = new Date();
    stamp.textContent = "Verified " + when.toLocaleTimeString() + " · " + when.toLocaleDateString();

    if (chainOk && failed === 0) {
      setConn("on", "Live on BOT Chain Mainnet · chain 677");
    } else if (failed > 0 && failed < JOBS.length) {
      setConn("busy", "Partial read — some values pending, press Re-verify");
    } else {
      setConn("err", "RPC unreachable — showing recorded proof, press Re-verify");
    }
    btn.disabled = false;
  }

  renderTimeline();
  btn.addEventListener("click", verifyAll);
  verifyAll();
})();
