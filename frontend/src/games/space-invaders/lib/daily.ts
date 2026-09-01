// Daily-challenge seed derivation — the client half of the certify contract.
//
// The backend verify worker (backend/internal/arcade/worker/verify_worker.ts
// fnv1aSeed) and its Go spec twin (validate.go invadersEngineSeed) derive the
// engine's numeric seed from the SAME seed string with the SAME function. If
// this copy drifts by one byte, the server's re-simulation stops matching the
// client's claim and every submission rejects — daily.test.ts pins the shared
// reference vectors so a drift fails here first.

/** The day's shared seed string, `invaders-YYYY-MM-DD` in UTC (toISOString is
 *  always UTC) — the grammar the backend parses into (game=invaders, daily). */
export function dailySeedString(now: Date = new Date()): string {
  return `invaders-${now.toISOString().slice(0, 10)}`;
}

/** FNV-1a (32-bit) over the seed string's UTF-8 bytes → the engine's uint32
 *  seed. Byte-for-byte the worker's fnv1aSeed / the backend's
 *  invadersEngineSeed — see the pinned vectors in daily.test.ts. */
export function seedFromSeedString(seed: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  const bytes = new TextEncoder().encode(seed);
  for (const b of bytes) {
    h = Math.imul(h ^ b, 0x01000193) >>> 0; // FNV prime
  }
  return h >>> 0;
}

/** The engine's fnv1a state digest formatted the ONE way the pipeline accepts:
 *  8 lowercase hex chars, zero-padded — the worker formats its recomputed hash
 *  with exactly `toString(16).padStart(8, "0")` and the submit handler string-
 *  compares claimedHash against it. */
export function formatStateHash(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}
