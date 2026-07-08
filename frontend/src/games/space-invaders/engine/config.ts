export const CONFIG = {
  arena: { w: 320, h: 400 },
  player: { w: 22, h: 12, speedPxPerMs: 0.16, baselineY: 380 },
  alien: { w: 16, h: 12, gapX: 12, gapY: 10, rows: 5, cols: 11, marginX: 20, startY: 40 },
  formation: { dropY: 12, stepDx: 8, stepMsMax: 700, stepMsMin: 90 },
  bullet: { w: 3, h: 8, playerSpeedPxPerMs: 0.4, alienSpeedPxPerMs: 0.18 },
  alienFire: { cooldownMs: 900 },
  lives: 3,
  respawnInvulnMs: 1500,
  points: [30, 20, 20, 10, 10] as const, // by row index; top row worth most
} as const;

export function formationStepMs(alive: number, total: number): number {
  const t = total <= 0 ? 1 : 1 - Math.max(0, Math.min(alive, total)) / total;
  return CONFIG.formation.stepMsMax + (CONFIG.formation.stepMsMin - CONFIG.formation.stepMsMax) * t;
}
