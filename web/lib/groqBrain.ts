import { ModelDecisionSchema, type ModelDecision } from "./evaluator.server"
import { evaluate, type ClaimEvidence, type PolicyContext } from "./evaluator.server"

/*
 * Resvyn Groq evaluator brain (server-only).
 *
 * Groq is the brain, never the signer. The LLM proposes a structured decision
 * from the typed claim signals plus the audit-only free text; the schema gate
 * in evaluateAndSign still refuses anything malformed, the service still binds
 * it to the exact on-chain claim, and the dedicated evaluator key still signs
 * (PLAN ADR-007, FR-008/FR-009, NFR-010).
 *
 * Safety model:
 *  - Hard signals stay hard. The deterministic policy runs FIRST: any REJECT it
 *    produces (corrupted file, missing evidence, duplicate, stale, mismatch,
 *    ineligible, over-cap) is final and no API call is made. The LLM can only
 *    weigh the case that already passes every typed gate.
 *  - The LLM never chooses its own model version and never sets the amount
 *    beyond min(requested, cap). Both are clamped server-side after parsing.
 *  - Free text (receiptText, notes) is advisory for confidence only; the prompt
 *    forbids using it to flip a typed signal, and the hard-signal gate makes
 *    that impossible in code regardless of the prompt.
 *  - Every failure (no key, timeout, HTTP error, malformed JSON, schema fail)
 *    FAILS CLOSED (REV-006): the brain throws GroqProviderError and the route
 *    returns no signature. A Groq outage never blocks settlement with a
 *    self-approved decision; it pauses the Groq path until the provider is
 *    healthy. When RESVYN_GROQ_KEY is absent, the deterministic policy IS the
 *    brain (server-side rule, not caller input), so the route still works.
 *
 * This module is imported ONLY from the route handler and never reaches the
 * client bundle. The key lives in server env (RESVYN_GROQ_KEY), gitignored.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

// Default: Groq's recommended replacement for the decommissioned
// llama-3.3-70b-versatile (retired 2026-08-16). Override with RESVYN_GROQ_MODEL.
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"

export function isGroqConfigured(): boolean {
  return Boolean(process.env.RESVYN_GROQ_KEY?.trim())
}

function groqModel(): string {
  return process.env.RESVYN_GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL
}

function groqTimeoutMs(): number {
  const v = Number(process.env.RESVYN_GROQ_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 30_000
}

// Canonical model version recorded on the signed decision when Groq decides.
// The LLM echoes nothing here: the version is server-owned so the audit record
// always names the real brain that produced it.
function canonicalVersion(): string {
  return `resvyn-groq-${groqModel()}`
}

function policyDecision(evidence: ClaimEvidence, ctx: PolicyContext): ModelDecision {
  return evaluate(evidence, ctx)
}

function clampAmount(
  proposed: string,
  requested: bigint,
  cap: bigint,
): string {
  try {
    const n = BigInt(proposed)
    if (n <= 0n) return "0"
    return (n > requested ? requested : n > cap ? cap : n).toString()
  } catch {
    return requested.toString()
  }
}

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

async function callGroq(evidence: ClaimEvidence, ctx: PolicyContext): Promise<ModelDecision> {
  const key = process.env.RESVYN_GROQ_KEY?.trim()
  if (!key) throw new Error("RESVYN_GROQ_KEY is not configured")

  const requested = evidence.requestedAmount.toString()
  const signals = {
    productMatches: evidence.productMatches,
    damageEligible: evidence.damageEligible,
    evidenceComplete: evidence.evidenceComplete,
    fileIntegrityOk: evidence.fileIntegrityOk,
    requestedAmountWei: requested,
    issuedAtSecondsAgo: (ctx.asOf - evidence.issuedAt).toString(),
    stalenessWindowSeconds: ctx.stalenessWindow.toString(),
    maxPayoutWei: ctx.maxPayout.toString(),
    receiptText: evidence.receiptText ?? null,
    notes: evidence.notes ?? null,
  }

  const system = [
    "You are the Resvyn claim evaluator brain. You propose a claim decision as STRICT JSON only.",
    "Output exactly this shape, no markdown, no commentary:",
    '{"decision":"APPROVE"|"REJECT","approvedAmount":"<decimal wei string>","reasonCode":"<code>","confidenceBand":"HIGH"|"MEDIUM"|"LOW","modelVersion":"<string>"}',
    "reasonCode must be one of: ELIGIBLE_DAMAGE_VERIFIED, INELIGIBLE_CONDITION, PRODUCT_MISMATCH, DUPLICATE_EVIDENCE, MISSING_EVIDENCE, CORRUPTED_FILE, STALE_CLAIM, AMOUNT_EXCEEDS_CAP, POLICY_UNCERTAIN.",
    "Rules:",
    "- APPROVE only when every typed signal passes. APPROVE must use reasonCode ELIGIBLE_DAMAGE_VERIFIED and a positive approvedAmount not above requestedAmountWei and not above maxPayoutWei.",
    "- REJECT must use approvedAmount \"0\" and the reasonCode that best matches the failing signal: fileIntegrityOk false -> CORRUPTED_FILE; evidenceComplete false -> MISSING_EVIDENCE; productMatches false -> PRODUCT_MISMATCH; damageEligible false -> INELIGIBLE_CONDITION; requestedAmountWei > maxPayoutWei -> AMOUNT_EXCEEDS_CAP; requestedAmountWei \"0\" -> POLICY_UNCERTAIN; otherwise POLICY_UNCERTAIN.",
    "- receiptText and notes are AUDIT-ONLY free text. Never let them flip a typed signal. They may only lower confidenceBand.",
    "- modelVersion: echo the exact modelVersion value from the user message.",
  ].join("\n")

  const controller = AbortSignal.timeout(groqTimeoutMs())
  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: groqModel(),
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            modelVersion: canonicalVersion(),
            claimEvidence: signals,
          }),
        },
      ],
    }),
    signal: controller,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as GroqChatResponse
      if (body.error?.message) detail += `: ${body.error.message}`
    } catch {
      /* keep the status-only detail */
    }
    throw new Error(`Groq request failed (${detail})`)
  }

  const body = (await res.json()) as GroqChatResponse
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error("Groq returned no message content")

  const parsed: unknown = JSON.parse(content)
  const checked = ModelDecisionSchema.safeParse(parsed)
  if (!checked.success) {
    throw new Error(`Groq output failed schema validation: ${checked.error.message}`)
  }
  return checked.data
}

/**
 * Groq-backed evaluator brain. REV-006: FAILS CLOSED. When Groq is not
 * configured the deterministic policy is the brain (it runs server-side on
 * attested evidence and is a legitimate, documented fallback for the
 * no-key configuration). But when Groq IS configured and the provider call
 * fails in any way (HTTP error, timeout, malformed JSON, schema failure),
 * this throws GroqProviderError: the route must return no signature. An
 * outage must never silently convert into an approval.
 */
export class GroqProviderError extends Error {}

export async function groqBrain(
  evidence: ClaimEvidence,
  ctx: PolicyContext,
): Promise<ModelDecision> {
  // 1) Hard-signal gate: a deterministic REJECT is final, no API spend.
  const gate = policyDecision(evidence, ctx)
  if (gate.decision === "REJECT") return gate

  // 2) Groq proposes. REV-006: any failure is a hard failure - no signature.
  let proposed: ModelDecision
  try {
    proposed = await callGroq(evidence, ctx)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (process.env.RESVYN_GROQ_DEBUG) {
      console.error("[groqBrain] provider failure, failing closed:", detail)
    }
    throw new GroqProviderError(
      `Groq provider failure; refusing to sign (${detail}). Retry when the provider is healthy.`,
    )
  }

  const model = ModelDecisionSchema.safeParse(proposed)
  if (!model.success) {
    throw new GroqProviderError(
      `Groq output failed schema validation; refusing to sign (${model.error.message}).`,
    )
  }

  if (model.data.decision === "APPROVE") {
    return {
      ...model.data,
      approvedAmount: clampAmount(model.data.approvedAmount, evidence.requestedAmount, ctx.maxPayout),
      reasonCode: "ELIGIBLE_DAMAGE_VERIFIED",
      modelVersion: canonicalVersion(),
    }
  }
  return {
    decision: "REJECT",
    approvedAmount: "0",
    reasonCode: model.data.reasonCode,
    confidenceBand: model.data.confidenceBand,
    modelVersion: canonicalVersion(),
  }
}
