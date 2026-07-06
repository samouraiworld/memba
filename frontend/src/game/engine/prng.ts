export type RngState = number;

// mulberry32 — returns a uint32 value and the next state.
// Every 32-bit multiply uses Math.imul; every op normalized to uint32.
// Go/Gno mirror: a := state + 0x6D2B79F5; t := (a ^ (a>>15)) * (1|a); ...
export function rngNext(state: RngState): { value: number; state: RngState } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, state: a >>> 0 };
}
