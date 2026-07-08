const KEY = "memba.space-invaders.best";

export function loadBest(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): number {
  const best = Math.max(loadBest(), Math.max(0, Math.floor(score)));
  try {
    localStorage.setItem(KEY, String(best));
  } catch {
    /* storage unavailable — best-effort only */
  }
  return best;
}
