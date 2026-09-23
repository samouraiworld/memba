/**
 * In-progress Daily (ranked) run persistence.
 *
 * Without this, refreshing the page dealt a fresh copy of today's board, so a
 * player could reload until a lucky run came along before signing in. The
 * saved record is only the accepted move log plus the challenge identity; the
 * board is always rebuilt by replaying the log through the engine, so a
 * tampered entry can at worst be rejected, never produce a board the engine
 * would not.
 *
 * Practice is never stored here.
 */
const VERSION = 1;
const PREFIX = `bp:run:v${VERSION}:`;
const MOVE_LOG = /^[URDL]*$/;
const MAX_LOG = 4096;

export type RunIdentity = { date: string; seed: number; modifier: string };
type RunRecord = RunIdentity & { version: typeof VERSION; log: string };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function runKey(chainId: string, date: string): string {
  return `${PREFIX}${encodeURIComponent(chainId || "default")}:${date}`;
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* storage denied — nothing to clean up */
  }
}

/**
 * The saved move log for this exact challenge, or null. Any entry that does
 * not match today's identity, or does not parse as a plain move log, is
 * removed so it can never be restored later.
 */
export function loadRun(chainId: string, run: RunIdentity): string | null {
  const key = runKey(chainId, run.date);
  let raw: string | null | undefined;
  try {
    raw = storage()?.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object") {
      const r = value as Partial<RunRecord>;
      if (
        r.version === VERSION &&
        r.date === run.date &&
        r.seed === run.seed &&
        r.modifier === run.modifier &&
        typeof r.log === "string" &&
        r.log.length <= MAX_LOG &&
        MOVE_LOG.test(r.log)
      ) {
        return r.log;
      }
    }
  } catch {
    /* corrupt JSON — fall through and drop it */
  }
  remove(key);
  return null;
}

export function saveRun(chainId: string, run: RunIdentity, log: string): void {
  if (!MOVE_LOG.test(log) || log.length > MAX_LOG) return;
  const key = runKey(chainId, run.date);
  const record: RunRecord = { version: VERSION, date: run.date, seed: run.seed, modifier: run.modifier, log };
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(record));
    // Earlier days' runs are dead weight once a new day has been saved.
    const scope = key.slice(0, key.length - run.date.length);
    for (let i = s.length - 1; i >= 0; i--) {
      const other = s.key(i);
      if (other && other !== key && other.startsWith(scope)) s.removeItem(other);
    }
  } catch {
    // Quota or denied storage: the run still plays, it just cannot survive a reload.
  }
}

export function clearRun(chainId: string, date: string): void {
  remove(runKey(chainId, date));
}
