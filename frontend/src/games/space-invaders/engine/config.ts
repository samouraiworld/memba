export const CONFIG = {
  arena: { w: 320, h: 400 },
  // maxBullets/fireCooldownMs power rapid fire: hold to stream shots (one every
  // ~140ms) with up to 3 on screen — snappier, more energetic play.
  player: { w: 22, h: 12, speedPxPerMs: 0.16, baselineY: 380, maxBullets: 3, fireCooldownMs: 140 },
  // startYMaxDrop caps how far later waves spawn down, so deep-wave difficulty
  // comes from faster fire (below), not from spawning inside the kill line.
  alien: { w: 16, h: 12, gapX: 8, gapY: 10, rows: 5, cols: 11, marginX: 32, startY: 40, startYMaxDrop: 50 },
  formation: { dropY: 12, stepDx: 8, stepMsMax: 700, stepMsMin: 90 },
  bullet: { w: 3, h: 8, playerSpeedPxPerMs: 0.6, alienSpeedPxPerMs: 0.18 },
  // Alien fire accelerates with the wave: cooldown drops perWaveMs each wave,
  // floored at cooldownMinMs.
  alienFire: { cooldownMs: 900, cooldownMinMs: 320, perWaveMs: 55 },
  // Mystery UFO: drifts across the top on a seeded timer. Base value is a
  // seeded pick; a hit on a parityShot-th shot pays the 300 bonus (the classic
  // risk/reward skill hook — track your shot count).
  ufo: { w: 24, h: 10, y: 22, speedPxPerMs: 0.09, spawnMs: 16000, points: [50, 100, 150] as const, bonusPoints: 300, parityShot: 23 },
  lives: 3,
  respawnInvulnMs: 1500,
  points: [40, 30, 20, 20, 10] as const, // by row index; top row worth most
  // End-of-game bonuses (integer). accuracyBonusK is the max accuracy award
  // (floor(hits*K/shots)); livesBonus is per surviving life.
  scoring: { accuracyBonusK: 500, livesBonus: 500 },
} as const;

export function formationStepMs(alive: number, total: number): number {
  const t = total <= 0 ? 1 : 1 - Math.max(0, Math.min(alive, total)) / total;
  return CONFIG.formation.stepMsMax + (CONFIG.formation.stepMsMin - CONFIG.formation.stepMsMax) * t;
}

// Alien fire cooldown for a given wave — shrinks each wave, floored at the
// minimum. wave 1 == base cooldown (unchanged), so it stays backward-compatible.
export function alienFireCooldownMs(wave: number): number {
  const scaled = CONFIG.alienFire.cooldownMs - (wave - 1) * CONFIG.alienFire.perWaveMs;
  return Math.max(CONFIG.alienFire.cooldownMinMs, scaled);
}

// No-miss combo → score multiplier, expressed as an integer ×10 numerator so
// scoring stays integer-only (JS number == Go float64 divergence-proof): the
// caller does floor(basePoints * comboMultiplier10(combo) / 10). The multiplier
// applies to the kill that *produces* the given (post-increment) combo, so the
// first kill (combo 1) is ×1.0 and preserves the original base-point scoring.
export function comboMultiplier10(combo: number): number {
  if (combo >= 10) return 40; // ×4.0
  if (combo >= 7) return 30; // ×3.0
  if (combo >= 4) return 20; // ×2.0
  if (combo >= 2) return 15; // ×1.5
  return 10; // ×1.0
}
