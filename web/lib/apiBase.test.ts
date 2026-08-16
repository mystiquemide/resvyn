import { describe, expect, it, afterEach, vi } from "vitest"

// apiBase reads the env at module scope, so re-import with a fresh module
// registry per case to observe each configuration.
async function freshApiUrl() {
  vi.resetModules()
  const mod = await import("./apiBase")
  return mod.apiUrl
}

const orig = process.env.NEXT_PUBLIC_RESVYN_API_BASE

afterEach(() => {
  if (orig === undefined) delete process.env.NEXT_PUBLIC_RESVYN_API_BASE
  else process.env.NEXT_PUBLIC_RESVYN_API_BASE = orig
})

describe("apiUrl / RESVYN_API_BASE", () => {
  it("keeps same-origin paths when no base is configured", async () => {
    delete process.env.NEXT_PUBLIC_RESVYN_API_BASE
    const apiUrl = await freshApiUrl()
    expect(apiUrl("/api/evidence")).toBe("/api/evidence")
    expect(apiUrl("/api/evaluate")).toBe("/api/evaluate")
  })

  it("prefixes the configured base and strips trailing slashes", async () => {
    process.env.NEXT_PUBLIC_RESVYN_API_BASE = "https://resvyn-api.example.com/"
    const apiUrl = await freshApiUrl()
    expect(apiUrl("/api/evidence")).toBe("https://resvyn-api.example.com/api/evidence")
  })
})
