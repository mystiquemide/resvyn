import type { Metadata } from "next"
import { Fraunces, Inter } from "next/font/google"
import "./globals.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  style: ["normal", "italic"],
})

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

// The public origin for social metadata. Set NEXT_PUBLIC_SITE_URL at deploy
// (for example https://resvyn.vercel.app) so og:image and link previews
// resolve to a real host. The default is the live production URL; a deploy
// without this var inherits the default. (resvyn.app is not resolvable and
// must not be used.)
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://resvyn.vercel.app").replace(/\/+$/, "")

export const metadata: Metadata = {
  title: "Resvyn · Verifiable warranty reserves",
  description:
    "Resvyn backs every warranty promise with a merchant-funded native BOT reserve. Coverage locks its own payout, and a bounded AI decision settles claims on BOT Chain Mainnet.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Resvyn · Verifiable warranty reserves",
    description:
      "Every warranty promise, backed by a reserve you can verify on chain.",
    type: "website",
    images: [{ url: "/logo.svg", width: 512, height: 512, alt: "Resvyn logo" }],
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
