// A fresh random seed per run — the fix for "every game is byte-identical".
// This lives in the shell, never in the deterministic engine, so using crypto
// here does not compromise the sim's Math.random/Date-free reproducibility.
let fallbackCounter = 0;

export function newRunSeed(): number {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === "function") {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] >>> 0;
    }
  } catch {
    /* crypto unavailable — fall through */
  }
  fallbackCounter = (fallbackCounter + 1) >>> 0;
  return (Math.floor(Math.random() * 0x100000000) ^ fallbackCounter) >>> 0;
}
