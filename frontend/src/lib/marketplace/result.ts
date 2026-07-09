/**
 * result.ts — a tiny Result<T> for realm-read decoding (marketplace-v2 Phase 2).
 *
 * Realm reads come back as unstructured strings (Amino-quoted CSV / markdown). The
 * data layer decodes them into a Result rather than throwing, so a malformed read
 * degrades to a soft "unavailable" in the UI instead of crashing a lane's render.
 *
 * @module lib/marketplace/result
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error })
