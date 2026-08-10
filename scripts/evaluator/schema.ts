import { z } from "zod";

// Resvyn claim evaluator: the strict decision schema (PLAN AI Design, FR-008,
// ADR-007). The evaluator "brain" (a policy engine today, a model provider
// later) emits ONLY this object. The service validates it against this schema
// before it touches a signing key, and refuses to sign anything that does not
// pass (FR-008: "never sign malformed output"). Unknown keys are rejected so a
// misbehaving or compromised brain cannot smuggle extra fields past signing.

// Fixed reason-code allowlist (PLAN "Fixed reason-code allowlist"). Exactly one
// approval code; every rejection maps to a specific, auditable cause. A code
// outside this set fails validation and is never signed.
export const APPROVE_REASON = "ELIGIBLE_DAMAGE_VERIFIED" as const;

export const REJECT_REASONS = [
  "INELIGIBLE_CONDITION",
  "PRODUCT_MISMATCH",
  "DUPLICATE_EVIDENCE",
  "MISSING_EVIDENCE",
  "CORRUPTED_FILE",
  "STALE_CLAIM",
  "AMOUNT_EXCEEDS_CAP",
  "POLICY_UNCERTAIN",
] as const;

export const REASON_CODES = [APPROVE_REASON, ...REJECT_REASONS] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const CONFIDENCE_BANDS = ["HIGH", "MEDIUM", "LOW"] as const;

// The raw evaluator output, before the service binds it to contract fields.
// approvedAmount is a decimal wei string so the object is JSON-safe end to end
// (a model provider returns JSON, not bigint).
export const ModelDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    approvedAmount: z
      .string()
      .regex(/^\d+$/, "approvedAmount must be a decimal wei string"),
    reasonCode: z.enum(REASON_CODES),
    confidenceBand: z.enum(CONFIDENCE_BANDS),
    modelVersion: z.string().min(1),
  })
  .strict()
  // A rejection can never carry a payout.
  .refine((d) => d.decision === "APPROVE" || d.approvedAmount === "0", {
    message: "A REJECT decision must have approvedAmount 0",
    path: ["approvedAmount"],
  })
  // An approval must carry a positive payout.
  .refine((d) => d.decision === "REJECT" || d.approvedAmount !== "0", {
    message: "An APPROVE decision must have a positive approvedAmount",
    path: ["approvedAmount"],
  })
  // The single approval reason is reserved for approvals, and vice versa.
  .refine((d) => (d.decision === "APPROVE") === (d.reasonCode === APPROVE_REASON), {
    message: "reasonCode must match the decision (approval reason iff APPROVE)",
    path: ["reasonCode"],
  });

export type ModelDecision = z.infer<typeof ModelDecisionSchema>;
