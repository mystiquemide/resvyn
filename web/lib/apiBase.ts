/**
 * API base for the Resvyn evaluator/evidence backend.
 *
 * The frontend can be hosted separately from the evaluator API (e.g. the
 * Vercel frontend with the VPS-hosted API). NEXT_PUBLIC_RESVYN_API_BASE
 * points at the API origin; when unset, calls stay same-origin so local
 * development and tests keep working unchanged.
 */
export const RESVYN_API_BASE = (
  process.env.NEXT_PUBLIC_RESVYN_API_BASE || ""
).replace(/\/+$/, "")

/** Resolve an API path against the configured base (same-origin fallback). */
export function apiUrl(path: string): string {
  return RESVYN_API_BASE ? `${RESVYN_API_BASE}${path}` : path
}
