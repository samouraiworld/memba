import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gameApi } from "../../lib/gameApi";

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const MODIFIERS = new Set(["standard", "doubles", "rush"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DailyChallenge = {
  date: string;
  seed: number;
  modifier: string;
  par: number;
  moveBudget: number;
  blockHeight: number;
  blockHash: string;
  ready: boolean;
  source: "network" | "cache";
  cachedAt?: number;
};

type ChallengeCache = {
  version: typeof CACHE_VERSION;
  scope: string;
  savedAt: number;
  challenge: Omit<DailyChallenge, "source" | "cachedAt">;
};

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function useUTCDate(requestedDate?: string): string {
  const [today, setToday] = useState(utcDate);
  useEffect(() => {
    if (requestedDate) return;
    const now = Date.now();
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 50);
    const timer = window.setTimeout(() => setToday(utcDate()), Math.max(1, next.valueOf() - now));
    return () => window.clearTimeout(timer);
  }, [requestedDate, today]);
  return requestedDate ?? today;
}

function cacheKey(scope: string, date: string): string {
  return `bp:challenge:v${CACHE_VERSION}:${encodeURIComponent(scope)}:${date}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function safeInt(value: unknown, min: number, max: number): number | null {
  if (
    typeof value !== "number" && typeof value !== "bigint" &&
    (typeof value !== "string" || !/^\d+$/.test(value))
  ) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeReadyChallenge(value: unknown, expectedDate: string): Omit<DailyChallenge, "source" | "cachedAt"> | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (c.ready !== true || c.date !== expectedDate || !isDate(c.date)) return null;
  const seed = safeInt(c.seed, 0, 0xffff_ffff);
  const par = safeInt(c.par, 0, Number.MAX_SAFE_INTEGER);
  const moveBudget = safeInt(c.moveBudget, 1, 4096);
  const blockHeight = safeInt(c.blockHeight, 1, Number.MAX_SAFE_INTEGER);
  if (
    seed == null || par == null || moveBudget == null || blockHeight == null ||
    typeof c.modifier !== "string" || !MODIFIERS.has(c.modifier) ||
    typeof c.blockHash !== "string" || c.blockHash.length === 0 || c.blockHash.length > 512
  ) return null;
  return {
    date: c.date,
    seed,
    modifier: c.modifier,
    par,
    moveBudget,
    blockHeight,
    blockHash: c.blockHash,
    ready: true,
  };
}

function normalizeResponse(value: unknown, expectedDate: string): DailyChallenge {
  if (value && typeof value === "object") {
    const c = value as Record<string, unknown>;
    if (c.ready === false && c.date === expectedDate && isDate(c.date)) {
      return {
        date: c.date,
        seed: 0,
        modifier: "standard",
        par: 0,
        moveBudget: 0,
        blockHeight: 0,
        blockHash: "",
        ready: false,
        source: "network",
      };
    }
  }
  const challenge = normalizeReadyChallenge(value, expectedDate);
  if (!challenge) throw new Error("Block Party returned an invalid daily challenge");
  return { ...challenge, source: "network" };
}

function readCached(scope: string, date: string): DailyChallenge | undefined {
  try {
    const raw = safeStorage()?.getItem(cacheKey(scope, date));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const record = value as Partial<ChallengeCache>;
    const age = Date.now() - Number(record.savedAt);
    if (
      record.version !== CACHE_VERSION || record.scope !== scope ||
      !Number.isFinite(age) || age < -5 * 60 * 1000 || age > CACHE_MAX_AGE_MS
    ) return undefined;
    const challenge = normalizeReadyChallenge(record.challenge, date);
    return challenge ? { ...challenge, source: "cache", cachedAt: Number(record.savedAt) } : undefined;
  } catch {
    return undefined;
  }
}

function writeCached(scope: string, challenge: DailyChallenge): void {
  if (!challenge.ready || challenge.source !== "network") return;
  const persisted: ChallengeCache["challenge"] = {
    date: challenge.date,
    seed: challenge.seed,
    modifier: challenge.modifier,
    par: challenge.par,
    moveBudget: challenge.moveBudget,
    blockHeight: challenge.blockHeight,
    blockHash: challenge.blockHash,
    ready: true,
  };
  const record: ChallengeCache = {
    version: CACHE_VERSION,
    scope,
    savedAt: Date.now(),
    challenge: persisted,
  };
  try {
    safeStorage()?.setItem(cacheKey(scope, challenge.date), JSON.stringify(record));
  } catch {
    // A cache is optional; never turn a valid network response into an error.
  }
}

/**
 * Fetch the UTC daily challenge. `scope` must identify the selected network
 * (or another backend identity) so immutable seeds never cross environments.
 * A validated same-date cache is exposed as initial data while revalidation
 * runs; callers can distinguish it through `data.source` and `isError`.
 */
export function useDailyChallenge(scope = "default", requestedDate?: string) {
  const date = useUTCDate(requestedDate);
  const cached = readCached(scope, date);
  return useQuery<DailyChallenge>({
    queryKey: ["bp", "challenge", scope, date],
    queryFn: async () => {
      const challenge = normalizeResponse(await gameApi.getDailyChallenge(date), date);
      writeCached(scope, challenge);
      return challenge;
    },
    initialData: cached,
    // Disk cache is continuity data, never proof of current availability.
    // Mark it stale so every mount immediately attempts live confirmation.
    initialDataUpdatedAt: cached ? 0 : undefined,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
