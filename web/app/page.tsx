import Link from "next/link"
import { ArrowRight, Lock, BadgeCheck, Landmark, ShieldCheck, PenLine, Store } from "lucide-react"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import ReserveMeter from "@/components/ReserveMeter"
import NetworkBadge from "@/components/NetworkBadge"
import { img, IMAGES } from "@/lib/images"
import { CURRENT_DEPLOYMENT, PROOF, explorerTx, explorerAddress } from "@/lib/chain"
import { shortAddr } from "@/lib/format"

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <HowItWorks />
        <ReserveVisible />
        <Checkpoint />
        <WhoFor />
        <ProofBand />
        <ClosingCta />
      </main>
      <Footer />
    </>
  )
}

function Hero() {
  return (
    <section
      className="hero-band"
      style={{
        position: "relative",
        overflow: "hidden",
        isolation: "isolate",
        minHeight: "clamp(520px, 78vh, 720px)",
        display: "flex",
        alignItems: "center",
        backgroundImage: `linear-gradient(100deg, var(--color-canvas) 0%, var(--color-canvas) 42%, color-mix(in srgb, var(--color-canvas) 28%, transparent) 68%, transparent 100%), url(${img(IMAGES.hero.id, 1800)})`,
        backgroundSize: "cover",
        backgroundPosition: "right center",
      }}
    >
      <div className="container-x" style={{ width: "100%", paddingBlock: "clamp(48px, 7vw, 88px)" }}>
        <div style={{ maxWidth: 640, minWidth: 0 }}>
          <h1
            className="display"
            style={{
              fontSize: "clamp(2.6rem, 5.6vw, 4.15rem)",
              margin: 0,
              overflowWrap: "anywhere",
            }}
          >
            Every warranty promise,
            <br />
            <span className="em">backed by a real reserve.</span>
          </h1>

          <p className="lead" style={{ marginTop: 20, maxWidth: 540 }}>
            Resvyn locks each coverage against a merchant-funded native BOT reserve.
            A bounded AI-assisted evaluator authorizes settlement, and every payout is provable on chain.
          </p>

          <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
            <Link href="/demo" className="btn btn-primary">
              See the demo <ArrowRight size={17} />
            </Link>
            <Link href="/proof" className="btn btn-ghost">
              View Mainnet proof
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Problem() {
  return (
    <section className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 116px)" }}>
      <div style={{ maxWidth: 820 }}>
        <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 0 }}>
          A promise is only as good as what stands behind it.
        </h2>
        <p className="lead" style={{ marginTop: 22, maxWidth: 680 }}>
          Merchants issue warranty promises every day with nothing set aside to honor them.
          When a claim lands, the money may not be there. Buyers have no way to tell a funded
          guarantee apart from a hopeful one.
        </p>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: Landmark,
      title: "Fund the reserve",
      body: "Merchants deposit native BOT into a reserve that anyone can read on chain.",
    },
    {
      icon: Lock,
      title: "Lock the payout",
      body: "Each policy locks its maximum payout against the free reserve. Over-issue, and the contract rejects it.",
    },
    {
      icon: BadgeCheck,
      title: "Settle on chain",
      body: "A claim is resolved by an evaluator whose signed decision the contract verifies before it pays.",
    },
  ]

  return (
    <section id="how" style={{ background: "color-mix(in srgb, var(--color-inset) 55%, var(--color-canvas))", borderBlock: "1px solid var(--color-hairline)" }}>
      <div className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 116px)" }}>
        <span className="kicker">How Resvyn works</span>
        <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 18, maxWidth: 720 }}>
          Fund the reserve. Lock the payout. <span className="em">Settle on chain.</span>
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
            marginTop: 48,
            alignItems: "stretch",
          }}
        >
          {steps.map((s, i) => (
            <div key={s.title} className="card" style={{ padding: 26 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: "var(--color-inset)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <s.icon size={20} color="var(--color-forest)" />
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", color: "var(--color-hairline)" }}>
                  0{i + 1}
                </span>
              </div>
              <h3 style={{ fontSize: "1.12rem", fontWeight: 600, marginTop: 20, lineHeight: 1.25 }}>{s.title}</h3>
              <p style={{ marginTop: 10, color: "var(--color-muted)", lineHeight: 1.55, fontSize: "0.96rem" }}>{s.body}</p>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: "30px 30px 32px", marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>The reserve at a glance</h3>
            <Link href="/proof" className="link-teal" style={{ fontSize: "0.9rem" }}>
              from the recorded Mainnet lifecycle
            </Link>
          </div>
          <div style={{ marginTop: 22, maxWidth: 620 }}>
            <ReserveMeter
              balanceWei={5000000000000000n}
              lockedWei={1000000000000000n}
              freeWei={4000000000000000n}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function ReserveVisible() {
  return (
    <section className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 116px)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 48,
          alignItems: "center",
        }}
      >
        <div>
          <span className="kicker">The reserve</span>
          <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 18 }}>
            You can see exactly <span className="em">what is covered.</span>
          </h2>
          <p className="lead" style={{ marginTop: 22 }}>
            Free reserve is the funded balance minus everything already locked by live coverage.
            Issuance can only draw from what is free, so exposure never runs ahead of the money
            behind it.
          </p>

          <div
            style={{
              marginTop: 28,
              padding: "20px 22px",
              borderRadius: 16,
              background: "var(--color-inset)",
              border: "1px solid var(--color-hairline)",
            }}
          >
            <div className="kicker" style={{ color: "var(--color-teal-ink)" }}>The invariant</div>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", marginTop: 8, letterSpacing: "-0.01em" }}>
              No funded reserve and no valid coverage.
            </p>
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <img
            src={img(IMAGES.vault.id, 1000)}
            alt="A bank vault door, the reserve made physical"
            loading="lazy"
            style={{ width: "100%", height: "auto", borderRadius: 22, border: "1px solid var(--color-hairline)", display: "block" }}
          />
        </div>
      </div>
    </section>
  )
}

function Checkpoint() {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        color: "var(--color-canvas)",
        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--color-forest) 92%, transparent), color-mix(in srgb, var(--color-forest) 92%, transparent)), url(${img(IMAGES.texture.id, 1600)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 120px)" }}>
        <div style={{ maxWidth: 720 }}>
          <span className="kicker" style={{ color: "color-mix(in srgb, var(--color-teal) 80%, #fff)" }}>The checkpoint</span>
          <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 18, color: "var(--color-canvas)" }}>
            A decision the contract can <span className="em">check.</span>
          </h2>
          <p style={{ marginTop: 22, fontSize: "1.1rem", lineHeight: 1.6, color: "color-mix(in srgb, var(--color-canvas) 82%, transparent)" }}>
            The evaluator returns a decision bound to one exact claim and signs it with EIP-712.
            An optional AI proposal sits behind deterministic policy and schema gates; the contract pays only when the final signed decision matches its immutable authority.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18, marginTop: 44 }}>
          {[
            { icon: PenLine, t: "Signed, not asserted", b: "Every decision carries an EIP-712 signature over the claim, amount, and chain." },
            { icon: ShieldCheck, t: "Bound to this contract", b: "Wrong chain, wrong verifier, or a reused decision is rejected before any payout." },
            { icon: BadgeCheck, t: "One key, set at deploy", b: "Only the evaluator signer fixed at deployment can authorize a settlement." },
          ].map((c) => (
            <div key={c.t} style={{ padding: 22, borderRadius: 16, background: "color-mix(in srgb, #fff 7%, transparent)", border: "1px solid color-mix(in srgb, #fff 14%, transparent)" }}>
              <c.icon size={22} color="var(--color-teal)" />
              <h3 style={{ marginTop: 14, fontSize: "1.02rem", fontWeight: 600 }}>{c.t}</h3>
              <p style={{ marginTop: 8, fontSize: "0.92rem", lineHeight: 1.55, color: "color-mix(in srgb, var(--color-canvas) 72%, transparent)" }}>{c.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function WhoFor() {
  return (
    <section className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 116px)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 48, alignItems: "center" }}>
        <div style={{ position: "relative", order: 0 }}>
          <img
            src={img(IMAGES.merchants.id, 1000)}
            alt="Two small-business owners standing in their shop"
            loading="lazy"
            style={{ width: "100%", height: "auto", borderRadius: 22, border: "1px solid var(--color-hairline)", display: "block" }}
          />
        </div>
        <div>
          <span className="kicker">Who it is for</span>
          <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 18 }}>
            Made for merchants who stand behind their work.
          </h2>
          <p className="lead" style={{ marginTop: 22 }}>
            Electronics resellers, appliance sellers, repair shops, and independent makers.
            Anyone who offers a guarantee and wants a buyer to trust it without taking their word for it.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "26px 0 0", display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              "Show buyers the coverage is funded",
              "Free reserve is always withdrawable back to you",
              "Every claim and payout leaves an on-chain trail",
            ].map((t) => (
              <li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ marginTop: 2, display: "inline-flex", width: 22, height: 22, borderRadius: 999, background: "var(--color-inset)", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Store size={13} color="var(--color-forest)" />
                </span>
                <span style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function ProofBand() {
  const resolve = PROOF.txs.find((t) => t.key === "resolve")!
  return (
    <section style={{ background: "color-mix(in srgb, var(--color-inset) 55%, var(--color-canvas))", borderBlock: "1px solid var(--color-hairline)" }}>
      <div className="container-x" style={{ paddingBlock: "clamp(64px, 9vw, 116px)" }}>
        <div style={{ maxWidth: 760 }}>
          <span className="kicker">Mainnet evidence</span>
          <h2 className="display" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", marginTop: 18 }}>
            Current deployment and <span className="em">recorded lifecycle proof.</span>
          </h2>
          <p className="lead" style={{ marginTop: 22 }}>
            The hardened contract is live and source-verified now. A separate archived contract preserves the earlier six-transaction lifecycle so the complete reserve-to-payout flow remains independently checkable.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 38, alignItems: "stretch" }}>
          <div className="card" style={{ padding: 28 }}>
            <NetworkBadge label="Current Mainnet deployment" sub="chain 677" />
            <dl style={{ margin: "22px 0 0", display: "grid", gap: 0 }}>
              <ProofRow k="Contract" v={shortAddr(CURRENT_DEPLOYMENT.contract)} href={explorerAddress(677, CURRENT_DEPLOYMENT.contract)} />
              <ProofRow k="Evaluator" v={shortAddr(CURRENT_DEPLOYMENT.evaluator)} />
              <ProofRow k="Deploy block" v={CURRENT_DEPLOYMENT.deploymentBlock.toString()} />
              <ProofRow k="Smoke reserve" v="0.001 BOT" />
              <ProofRow k="Source" v="Verified on BOTScan" href={`${explorerAddress(677, CURRENT_DEPLOYMENT.contract)}?tab=contract`} last />
            </dl>
          </div>

          <div className="card" style={{ padding: 28 }}>
            <NetworkBadge label="Recorded lifecycle proof" sub="archived · chain 677" />
            <dl style={{ margin: "22px 0 0", display: "grid", gap: 0 }}>
              <ProofRow k="Contract" v={shortAddr(PROOF.contract)} href={explorerAddress(677, PROOF.contract)} />
              <ProofRow k="Reserve funded" v={`${PROOF.deposited} BOT`} />
              <ProofRow k="Evaluator payout" v={`${PROOF.paid} BOT to buyer`} href={explorerTx(677, resolve.hash)} />
              <ProofRow k="Reserve reconciled" v="0 / 0 / 0" />
              <ProofRow k="Runtime on chain" v={`${PROOF.runtimeBytes.toLocaleString()} bytes`} last />
            </dl>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
          <Link href="/proof" className="btn btn-primary">
            Verify both deployments <ArrowRight size={17} />
          </Link>
          <a href={explorerAddress(677, CURRENT_DEPLOYMENT.contract)} target="_blank" rel="noopener" className="btn btn-ghost">
            Current contract on BOTScan
          </a>
        </div>
      </div>
    </section>
  )
}

function ProofRow({ k, v, href, last }: { k: string; v: string; href?: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "13px 0",
        borderBottom: last ? "none" : "1px solid var(--color-hairline)",
        minWidth: 0,
      }}
    >
      <dt style={{ color: "var(--color-muted-2)", fontSize: "0.9rem" }}>{k}</dt>
      <dd style={{ margin: 0, fontWeight: 500, fontSize: "0.95rem", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
        {href ? (
          <a href={href} target="_blank" rel="noopener" className="link-teal">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  )
}

function ClosingCta() {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        color: "var(--color-canvas)",
        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--color-forest) 62%, transparent), color-mix(in srgb, var(--color-forest) 86%, transparent)), url(${img(IMAGES.hills.id, 1800)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="container-x" style={{ paddingBlock: "clamp(84px, 12vw, 160px)", textAlign: "center" }}>
        <h2 className="display" style={{ fontSize: "clamp(2.2rem, 5vw, 3.8rem)", color: "var(--color-canvas)", maxWidth: 820, marginInline: "auto" }}>
          Warranties people can <span className="em">actually trust.</span>
        </h2>
        <div style={{ display: "flex", gap: 14, marginTop: 34, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/app" className="btn btn-on-dark">
            Launch app <ArrowRight size={17} />
          </Link>
          <Link href="/demo" className="btn btn-ghost" style={{ color: "var(--color-canvas)", borderColor: "color-mix(in srgb, #fff 40%, transparent)" }}>
            See the demo
          </Link>
        </div>
      </div>
    </section>
  )
}
