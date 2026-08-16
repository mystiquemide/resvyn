import { describe, expect, it } from "vitest"
import { getAddress } from "viem"
import { evaluateMessage, intakeMessage } from "./evaluateAuth"

const LOWER = "0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe" as `0x${string}`
const CHECKSUMMED = getAddress(LOWER)

const content = {
  productNote: "Resvyn Demo Wireless Earbuds",
  receiptNote: "RESVYN-FINAL-PROOF-2026-001",
  damageDescription: "Right earbud stopped producing audio during normal use.",
  damageEligible: true,
  evidenceComplete: true,
  fileIntegrityOk: true,
  requestedAmountWei: "500000000000000",
  issuedAt: 1_700_000_000,
}

describe("auth message verifier canonicalization", () => {
  it("produces the same evaluate message from lowercase and checksummed verifier addresses", () => {
    const common = { chainId: 677, coverageId: "1", claimId: "1", timestamp: 1_700_000_100 }
    expect(evaluateMessage({ ...common, verifier: LOWER })).toBe(
      evaluateMessage({ ...common, verifier: CHECKSUMMED }),
    )
    expect(evaluateMessage({ ...common, verifier: LOWER })).toContain(CHECKSUMMED)
  })

  it("produces the same evidence intake message from lowercase and checksummed verifier addresses", () => {
    const common = {
      chainId: 677,
      coverageId: "1",
      claimId: "1",
      evidenceHash: "0xcf183bb9d7fb810442c1638898d1ac47b76ce67d91b4e4b649cfb8b1a7f8da66" as `0x${string}`,
      content,
      timestamp: 1_700_000_100,
    }
    expect(intakeMessage({ ...common, verifier: LOWER })).toBe(
      intakeMessage({ ...common, verifier: CHECKSUMMED }),
    )
    expect(intakeMessage({ ...common, verifier: LOWER })).toContain(CHECKSUMMED)
  })
})
