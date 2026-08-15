import Link from "next/link"
import { explorerAddress } from "@/lib/chain"
import { PROOF } from "@/lib/chain"

export default function Footer() {
  return (
    <footer style={{ background: "var(--color-forest)", color: "var(--color-canvas)" }}>
      <div className="container-x" style={{ paddingTop: 64, paddingBottom: 40 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 40,
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ maxWidth: 320 }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.6rem",
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Resvyn
            </span>
            <p style={{ marginTop: 12, color: "color-mix(in srgb, var(--color-canvas) 72%, transparent)", lineHeight: 1.6, fontSize: "0.95rem" }}>
              Every warranty promise, backed by a merchant-funded reserve you can verify on chain.
            </p>
          </div>

          <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
            <FooterCol
              title="Product"
              links={[
                { href: "/#how", label: "How it works" },
                { href: "/demo", label: "Guided demo" },
                { href: "/reserve", label: "Look up a reserve" },
                { href: "/app", label: "Launch app" },
              ]}
            />
            <FooterCol
              title="Proof"
              links={[
                { href: "/proof", label: "Mainnet proof" },
                { href: explorerAddress(677, PROOF.contract), label: "Contract on BOTScan", external: true },
                { href: "https://github.com/mystiquemide/resvyn", label: "Source on GitHub", external: true },
              ]}
            />
            <FooterCol
              title="Legal"
              links={[
                { href: "/faq", label: "FAQ" },
                { href: "/terms", label: "Terms" },
                { href: "/privacy", label: "Privacy" },
              ]}
            />
          </div>
        </div>

        <hr style={{ border: 0, height: 1, background: "color-mix(in srgb, var(--color-canvas) 16%, transparent)", margin: "40px 0 24px" }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", color: "color-mix(in srgb, var(--color-canvas) 62%, transparent)" }}>
          <span>© 2026 Resvyn · Proven on BOT Chain Mainnet, chain 677</span>
          <span>Verifiable on BOT Chain Mainnet</span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: { href: string; label: string; external?: boolean }[]
}) {
  return (
    <div>
      <div className="kicker" style={{ color: "color-mix(in srgb, var(--color-canvas) 55%, transparent)", marginBottom: 14 }}>
        {title}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {links.map((l) =>
          l.external ? (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener" style={footerLinkStyle}>
                {l.label}
              </a>
            </li>
          ) : (
            <li key={l.href}>
              <Link href={l.href} style={footerLinkStyle}>
                {l.label}
              </Link>
            </li>
          )
        )}
      </ul>
    </div>
  )
}

const footerLinkStyle: React.CSSProperties = {
  color: "color-mix(in srgb, var(--color-canvas) 85%, transparent)",
  textDecoration: "none",
  fontSize: "0.95rem",
}
