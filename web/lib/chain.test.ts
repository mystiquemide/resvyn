import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { evaluatorSignerMatches, isOperationalDeployment, isArchivedProofInstance } from "./chain"

const PROOF_ADDR = "0x414592d2313d233b673b1f97803c261355ccd996"
const OTHER_ADDR = "0x1111111111111111111111111111111111111111"
const EVALUATOR = "0x2222222222222222222222222222222222222222"

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL
  delete process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR
  delete process.env.NEXT_PUBLIC_RESVYN_ADDRESS
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL
  delete process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR
  delete process.env.NEXT_PUBLIC_RESVYN_ADDRESS
})

describe("deployment gate (REV-002)", () => {
  it("treats the recorded proof instance as archived", () => {
    expect(isArchivedProofInstance(PROOF_ADDR)).toBe(true)
    expect(isArchivedProofInstance(OTHER_ADDR)).toBe(false)
  })

  // REV-002 round 3: the evaluator pin is REQUIRED. Without
  // NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR the app must be read-only, so a
  // misconfigured deployment can never lock funds before evaluator
  // compatibility is established.
  it("requires the evaluator pin before any deployment is operational", () => {
    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL = "1"
    process.env.NEXT_PUBLIC_RESVYN_ADDRESS = OTHER_ADDR
    // No pin: not operational.
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(false)
    // Pin set: operational at the address level (signer match checked too).
    process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR = EVALUATOR
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(true)
    // The proof instance stays archived even with the pin.
    expect(isOperationalDeployment(PROOF_ADDR)).toBe(false)
  })

  it("evaluatorSignerMatches fails closed without a pin", () => {
    expect(evaluatorSignerMatches(undefined, EVALUATOR)).toBe(false)
    expect(evaluatorSignerMatches(undefined, undefined)).toBe(false)
    expect(evaluatorSignerMatches(EVALUATOR, EVALUATOR.toLowerCase())).toBe(true)
    expect(evaluatorSignerMatches(EVALUATOR, "0x9999999999999999999999999999999999999999")).toBe(false)
    expect(evaluatorSignerMatches(EVALUATOR, undefined)).toBe(false)
  })
})
