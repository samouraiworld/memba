// mulberry32 — deterministic uint32 PRNG. Mirrors Block Party's engine prng.
export function rngNext(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, state: a >>> 0 };
}

export function rngFloat(state: number): { value: number; state: number } {
  const n = rngNext(state);
  return { value: n.value / 0x100000000, state: n.state };
}
