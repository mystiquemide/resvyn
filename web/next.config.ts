import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: dir },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // The app renders inline styles and the App Router injects inline
            // scripts for the RSC payload, so style-src and script-src carry
            // 'unsafe-inline'. Wallet reads go to the BOT Chain Mainnet RPC;
            // landing imagery comes from images.unsplash.com.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://images.unsplash.com",
              "font-src 'self' data:",
              "connect-src 'self' https://rpc.botchain.ai",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
