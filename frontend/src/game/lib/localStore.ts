const STREAK_KEY = "bp:streak";
const EMPTY_STREAK = Object.freeze({ current: 0, lastDate: "" });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LocalStreak = { current: number; lastDate: string };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Safari private mode, disabled cookies, and embedded browsers may expose
    // the property but throw as soon as it is touched.
    return null;
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function safeNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function getLocalBest(key: string): number {
  if (!key) return 0;
  try {
    return safeNonNegativeInt(storage()?.getItem(`bp:best:${key}`)) ?? 0;
  } catch {
    return 0;
  }
}

export function setLocalBest(key: string, score: number): void {
  if (!key) return;
  const next = safeNonNegativeInt(score);
  if (next == null || next <= getLocalBest(key)) return;
  try {
    storage()?.setItem(`bp:best:${key}`, String(next));
  } catch {
    // Persistence is a progressive enhancement; gameplay must remain usable
    // if the quota is exhausted or storage is denied.
  }
}

export function getLocalStreak(): LocalStreak {
  try {
    const raw = storage()?.getItem(STREAK_KEY);
    if (!raw) return { ...EMPTY_STREAK };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...EMPTY_STREAK };
    const candidate = value as Record<string, unknown>;
    const current = safeNonNegativeInt(candidate.current);
    const lastDate = candidate.lastDate;
    const hasEmptyDate = lastDate === "";
    if (current == null || (hasEmptyDate ? current !== 0 : !validDate(lastDate))) {
      return { ...EMPTY_STREAK };
    }
    return { current, lastDate: lastDate as string };
  } catch {
    return { ...EMPTY_STREAK };
  }
}

function dayGap(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000;
}

export function bumpLocalStreak(date: string): LocalStreak {
  if (!validDate(date)) return getLocalStreak();

  const previous = getLocalStreak();
  // Late effects, restored browser tabs, and old result sheets must never
  // rewind the last played date or destroy a newer streak.
  if (previous.lastDate && dayGap(previous.lastDate, date) < 0) return previous;

  let current = 1;
  if (previous.lastDate) {
    const gap = dayGap(previous.lastDate, date);
    if (gap === 0) current = previous.current;
    else if (gap === 1) current = previous.current + 1;
  }
  const next = { current, lastDate: date };
  try {
    storage()?.setItem(STREAK_KEY, JSON.stringify(next));
  } catch {
    // Return the useful in-memory result even when it cannot be persisted.
  }
  return next;
}
