/** Milliseconds until the next 00:00 UTC, when a new Daily board is dealt. */
export function msUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(0, next - now);
}

function parts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** Visual clock form: `HH:MM:SS`. */
export function formatClock(ms: number): string {
  const { h, m, s } = parts(ms);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Spoken form, minute precision so a screen reader is not handed a value that
 * is stale a second later: "3 hours 12 minutes", "45 minutes", "less than a minute".
 */
export function formatSpoken(ms: number): string {
  const { h, m } = parts(ms);
  if (h === 0 && m === 0) return "less than a minute";
  const hours = h > 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const minutes = m > 0 ? `${m} ${m === 1 ? "minute" : "minutes"}` : "";
  return [hours, minutes].filter(Boolean).join(" ");
}
