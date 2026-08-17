import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CURRENT_DEPLOYMENT, PROOF, isOperationalDeployment } from "./chain"

const OTHER_ADDR = "0x1111111111111111111111111111111111111111"
const OTHER_EVALUATOR = "0x2222222222222222222222222222222222222222"

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL
  delete process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL
  delete process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR
})

describe("current deployment operational mode", () => {
  it("keeps the current hardened deployment operational by default", () => {
    expect(isOperationalDeployment(CURRENT_DEPLOYMENT.contract)).toBe(true)
  })

  it("allows an explicit emergency read-only override", () => {
    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL = "0"
    expect(isOperationalDeployment(CURRENT_DEPLOYMENT.contract)).toBe(false)
  })

  it("keeps the archived proof contract permanently read-only", () => {
    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL = "1"
    process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR = OTHER_EVALUATOR
    expect(isOperationalDeployment(PROOF.contract)).toBe(false)
  })

  it("still requires an explicit operational flag and evaluator pin for custom deployments", () => {
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(false)

    process.env.NEXT_PUBLIC_RESVYN_OPERATIONAL = "1"
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(false)

    process.env.NEXT_PUBLIC_RESVYN_EXPECTED_EVALUATOR = OTHER_EVALUATOR
    expect(isOperationalDeployment(OTHER_ADDR)).toBe(true)
  })
})
