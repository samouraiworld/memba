import { rngNext } from "./prng";
import type { Modifier } from "./types";

/**
 * An absolute score ceiling for a run with this many successful moves.
 *
 * A run starts with two tiles and every successful move spawns exactly one
 * more. Standard/Rush spawns are at most 4; Doubles spawns are at most 8.
 * At merge level k, at most floor(tileCount / 2^k) groups can reach that
 * level, and each contributes spawnMax * 2^k points at that merge. Summing
 * those levels gives a generous upper bound: board geometry and spawn odds
 * can only reduce it.
 *
 * This is intentionally analysis/UI tooling, not a gameplay rule. Changing it
 * cannot change a replay, RNG consumption, scoring, or score hashes.
 */
export function theoreticalScoreCeiling(modifier: Modifier, successfulMoveBudget: number): number {
  if (!Number.isSafeInteger(successfulMoveBudget) || successfulMoveBudget < 0) {
    throw new RangeError("successfulMoveBudget must be a non-negative safe integer");
  }

  const spawnMax = modifier === "doubles" ? 8 : 4;
  const tileCount = successfulMoveBudget + 2;
  let ceiling = 0;

  for (let groupSize = 2; groupSize <= tileCount; groupSize *= 2) {
    ceiling += Math.floor(tileCount / groupSize) * groupSize * spawnMax;
  }
  return ceiling;
}

export function isParTheoreticallyReachable(
  par: number,
  modifier: Modifier,
  successfulMoveBudget: number
): boolean {
  return Number.isFinite(par) && par >= 0 && par <= theoreticalScoreCeiling(modifier, successfulMoveBudget);
}

/**
 * A tighter ceiling using the challenge's actual deterministic spawn values.
 * Board geometry is deliberately ignored, so this remains an upper bound.
 */
export function seedScoreCeiling(seed: number, modifier: Modifier, successfulMoveBudget: number): number {
  if (!Number.isSafeInteger(successfulMoveBudget) || successfulMoveBudget < 0) {
    throw new RangeError("successfulMoveBudget must be a non-negative safe integer");
  }

  let rng = seed >>> 0;
  const counts = new Map<number, number>();
  for (let spawn = 0; spawn < successfulMoveBudget + 2; spawn++) {
    rng = rngNext(rng).state; // position draw
    const valueDraw = rngNext(rng);
    rng = valueDraw.state;
    let value = valueDraw.value % 10 === 0 ? 4 : 2;
    if (modifier === "doubles") value *= 2;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let score = 0;
  for (let value = 2; value <= 256; value *= 2) {
    const pairs = Math.floor((counts.get(value) ?? 0) / 2);
    if (pairs === 0) continue;
    const merged = value * 2;
    score += pairs * merged;
    counts.set(merged, (counts.get(merged) ?? 0) + pairs);
  }
  return score;
}
