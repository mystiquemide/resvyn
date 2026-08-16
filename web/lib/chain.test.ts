import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  CURRENT_DEPLOYMENT,
  PROOF,
  evaluatorSignerMatches,
  isOperationalDeployment,
  isArchivedProofInstance,
} from "./chain"

const PROOF_ADDR = "0x414592d2313d233b673b1f97803c261355ccd996"
const CURRENT_ADDR = "0x96829b22ae7e59ac0f7d2ca6c50d017b51954ffe"
const CURRENT_EVALUATOR = "0xf1527ad9E09728A9ca0b9c8968E3f6297A9b97D0"
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

describe("deployment manifest", () => {
  it("keeps the current deployment separate from the archived lifecycle proof", () => {
    expect(CURRENT_DEPLOYMENT.contract).toBe(CURRENT_ADDR)
    expect(CURRENT_DEPLOYMENT.evaluator).toBe(CURRENT_EVALUATOR)
    expect(CURRENT_DEPLOYMENT.deploymentBlock).toBe(19898630n)
    expect(PROOF.contract).toBe(PROOF_ADDR)
    expect(CURRENT_DEPLOYMENT.contract.toLowerCase()).not.toBe(PROOF.contract.toLowerCase())
  })
})

describe("deployment gate (REV-002)", () => {
  it("treats only the recorded proof instance as archived", () => {
    expect(isArchivedProofInstance(PROOF_ADDR)).toBe(true)
    expect(isArchivedProofInstance(CURRENT_ADDR)).toBe(false)
    expect(isArchivedProofInstance(OTHER_ADDR)).toBe(false)
  })

  it("requires the evaluator pin before any non-archived deployment is operational", () => {
    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL = "1"
    process.env.NEXT_PUBLIC_RESVYN_ADDRESS = OTHER_ADDR

    expect(isOperationalDeployment(OTHER_ADDR)).toBe(false)

    process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR = EVALUATOR
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(true)
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
