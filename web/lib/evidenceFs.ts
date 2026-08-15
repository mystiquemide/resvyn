/*
 * Filesystem half of the evidence store, isolated behind a dynamic import so
 * Turbopack does not trace the whole project for a dynamic store path
 * (REV-005r4/low: build tracing warnings).
 *
 * This module is ONLY imported via `await import("./evidenceFs.js")` from
 * evidenceStore.ts, so the store path stays configurable at runtime.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs"
import { dirname } from "node:path"

export async function loadStore(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, "utf8")
  return JSON.parse(raw) as Record<string, unknown>
}

/** Atomic replace: write to a temp file, then rename over the target. */
export async function persistStore(path: string, data: Record<string, unknown>): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, path)
}
