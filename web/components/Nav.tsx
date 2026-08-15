"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Menu, X } from "lucide-react"

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/demo", label: "Demo" },
  { href: "/reserve", label: "Reserve" },
  { href: "/proof", label: "Proof" },
]

export default function Nav({ variant = "marketing" }: { variant?: "marketing" | "app" }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isApp = variant === "app"

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "color-mix(in srgb, var(--color-canvas) 82%, transparent)",
        backdropFilter: "saturate(1.1) blur(10px)",
        borderBottom: "1px solid var(--color-hairline)",
      }}
    >
      <nav className="container-x" style={{ display: "flex", alignItems: "center", height: 68, gap: 24 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <Wordmark />
        </Link>

        <div style={{ flex: 1 }} />

        {isApp && (
          <Link
            href="/"
            style={{
              textDecoration: "none",
              fontSize: "0.92rem",
              fontWeight: 500,
              color: pathname === "/" ? "var(--color-ink)" : "var(--color-muted)",
              borderBottom: "2px solid transparent",
              paddingBottom: 2,
            }}
          >
            Back to Home
          </Link>
        )}

        {!isApp && (
        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {LINKS.map((l) => {
            const route = l.href.split("#")[0] || "/"
            const active = l.href.includes("#") ? false : pathname === route
            return (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  textDecoration: "none",
                  fontSize: "0.92rem",
                  fontWeight: 500,
                  color: active ? "var(--color-ink)" : "var(--color-muted)",
                  borderBottom: active ? "2px solid var(--color-teal)" : "2px solid transparent",
                  paddingBottom: 2,
                }}
              >
                {l.label}
              </Link>
            )
          })}
          <Link href="/app" className="btn btn-primary" style={{ padding: "0.6rem 1.1rem", fontSize: "0.9rem" }}>
            Launch app
          </Link>
        </div>
        )}

        {!isApp && (
        <button
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="nav-toggle"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "none",
            background: "transparent",
            border: "1px solid var(--color-hairline)",
            borderRadius: 10,
            padding: 8,
            cursor: "pointer",
            color: "var(--color-ink)",
          }}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        )}
      </nav>

      {open && !isApp && (
        <div id="mobile-menu" className="container-x" style={{ paddingBottom: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{ textDecoration: "none", color: "var(--color-ink)", fontWeight: 500, padding: "10px 4px" }}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/app" onClick={() => setOpen(false)} className="btn btn-primary" style={{ marginTop: 6, justifyContent: "center" }}>
            Launch app
          </Link>
        </div>
      )}

      <style>{`
        @media (max-width: 760px) {
          .nav-links { display: none !important; }
          .nav-toggle { display: inline-flex !important; }
        }
      `}</style>
    </header>
  )
}

function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <img src="/logo-mark.svg" alt="" width={26} height={26} aria-hidden="true" style={{ display: "block" }} />
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.5rem",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
          }}
        >
          Resvyn
        </span>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--color-teal)", marginLeft: 1 }} />
      </span>
    </span>
  )
}
