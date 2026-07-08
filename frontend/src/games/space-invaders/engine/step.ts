import { CONFIG, formationStepMs, comboMultiplier10 } from "./config";
import type { GameState, GameEvent, InputIntent } from "./types";
import { aabb } from "./collision";
import { rngFloat } from "./prng";
import { spawnWave } from "./spawn";

// Apply end-of-game bonuses (accuracy + surviving lives) and enter gameover.
// Integer-only so the future Go replay verifier reproduces it exactly.
function finalize(s: GameState): GameState {
  const accuracy = s.shots > 0 ? Math.floor((s.hits * CONFIG.scoring.accuracyBonusK) / s.shots) : 0;
  const livesBonus = Math.max(0, s.lives) * CONFIG.scoring.livesBonus;
  return { ...s, phase: "gameover", score: s.score + accuracy + livesBonus };
}

// This reducer stays pure: it has no memory of the previous frame's pause
// state. Callers are expected to send pause:true for a single frame only
// (i.e. an edge, not a held key) — every such frame flips playing/paused.
export function step(state: GameState, dtMs: number, input: InputIntent): GameState {
  // Fresh per-step event list (bounded) and the monotonic tick — both threaded
  // through every `{ ...s }` below via the shared `events` array reference.
  const events: GameEvent[] = [];
  let s: GameState = { ...state, tick: state.tick + 1, events };

  // Pause toggle (edge is produced by the input layer; here pause:true flips).
  if (input.pause) {
    if (s.phase === "playing") return { ...s, phase: "paused" };
    if (s.phase === "paused") return { ...s, phase: "playing" };
  }
  if (s.phase === "paused" || s.phase === "gameover") return s;

  // Start on first meaningful input.
  if (s.phase === "ready") {
    if (input.move !== 0 || input.fire) s = { ...s, phase: "playing" };
    else return s;
  }

  // Player movement, clamped.
  if (input.move !== 0) {
    const dx = input.move * CONFIG.player.speedPxPerMs * dtMs;
    const maxX = CONFIG.arena.w - s.player.w;
    const x = Math.max(0, Math.min(maxX, s.player.x + dx));
    s = { ...s, player: { ...s.player, x } };
  }

  // Fire-rate cooldown decay.
  if (s.fireCd > 0) s = { ...s, fireCd: Math.max(0, s.fireCd - dtMs) };

  // Fire: rapid fire — spawn a bullet when off cooldown and under the cap.
  if (input.fire && s.fireCd <= 0 && s.playerBullets.length < CONFIG.player.maxBullets) {
    const bx = s.player.x + s.player.w / 2 - CONFIG.bullet.w / 2;
    s = {
      ...s,
      shots: s.shots + 1,
      fireCd: CONFIG.player.fireCooldownMs,
      playerBullets: [
        ...s.playerBullets,
        { x: bx, y: s.player.y - CONFIG.bullet.h, w: CONFIG.bullet.w, h: CONFIG.bullet.h, alive: true },
      ],
    };
    events.push({ type: "playerFired", x: bx });
  }

  // ── Formation march (fixed-cadence, accelerating as ranks thin) ──
  const living = s.aliens.filter((a) => a.alive);
  if (living.length > 0) {
    const cadence = formationStepMs(living.length, s.aliens.length);
    let accum = s.stepAccumMs + dtMs;
    if (accum >= cadence) {
      accum -= cadence;
      events.push({ type: "alienStep", dir: s.dir });
      const minX = Math.min(...living.map((a) => a.x));
      const maxX = Math.max(...living.map((a) => a.x + a.w));
      const dx = s.dir * CONFIG.formation.stepDx;
      const hitsEdge = minX + dx < 0 || maxX + dx > CONFIG.arena.w;
      if (hitsEdge) {
        s = {
          ...s,
          dir: (s.dir * -1) as 1 | -1,
          aliens: s.aliens.map((a) => (a.alive ? { ...a, y: a.y + CONFIG.formation.dropY } : a)),
          stepAccumMs: accum,
        };
      } else {
        s = {
          ...s,
          aliens: s.aliens.map((a) => (a.alive ? { ...a, x: a.x + dx } : a)),
          stepAccumMs: accum,
        };
      }
    } else {
      s = { ...s, stepAccumMs: accum };
    }
  }

  // Advance player bullets; resolve alien hits and misses (rapid fire — several
  // bullets may be in flight, each resolved independently this step).
  if (s.playerBullets.length > 0) {
    let aliens = s.aliens;
    let combo = s.combo;
    let hits = s.hits;
    let score = s.score;
    const survivors: typeof s.playerBullets = [];
    for (const pb of s.playerBullets) {
      const b = { ...pb, y: pb.y - CONFIG.bullet.playerSpeedPxPerMs * dtMs };
      if (b.y + b.h < 0) {
        // Shot left the top without a kill → the no-miss combo breaks.
        combo = 0;
        events.push({ type: "shotMissed" });
        continue;
      }
      let hitIdx = -1;
      for (let i = 0; i < aliens.length; i++) {
        const a = aliens[i];
        if (a.alive && aabb(b, a)) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx >= 0) {
        const a = aliens[hitIdx];
        const hitScore = CONFIG.points[a.row] ?? CONFIG.points[CONFIG.points.length - 1];
        // combo increments first; the multiplier applies to this kill, so the
        // first hit is ×1.0 (preserves base-point scoring).
        combo += 1;
        score += Math.floor((hitScore * comboMultiplier10(combo)) / 10);
        hits += 1;
        aliens = aliens.map((x, i) => (i === hitIdx ? { ...x, alive: false } : x));
        events.push({ type: "alienKilled", x: a.x, y: a.y, row: a.row });
      } else {
        survivors.push(b);
      }
    }
    s = { ...s, aliens, playerBullets: survivors, combo, hits, score };
  }

  // Invulnerability countdown.
  if (s.invulnMs > 0) {
    s = { ...s, invulnMs: Math.max(0, s.invulnMs - dtMs) };
  }

  // Alien fire on cooldown (seeded).
  {
    const living = s.aliens.filter((a) => a.alive);
    const fireMs = s.alienFireMs - dtMs;
    if (fireMs <= 0 && living.length > 0) {
      const pick = rngFloat(s.rng);
      const shooter = living[Math.floor(pick.value * living.length)];
      const bullet = {
        x: shooter.x + shooter.w / 2 - CONFIG.bullet.w / 2,
        y: shooter.y + shooter.h,
        w: CONFIG.bullet.w,
        h: CONFIG.bullet.h,
        alive: true,
      };
      s = {
        ...s,
        rng: pick.state,
        alienBullets: [...s.alienBullets, bullet],
        alienFireMs: CONFIG.alienFire.cooldownMs,
      };
    } else {
      s = { ...s, alienFireMs: fireMs };
    }
  }

  // Advance alien bullets; resolve player damage.
  if (s.alienBullets.length > 0) {
    const moved = s.alienBullets
      .map((b) => ({ ...b, y: b.y + CONFIG.bullet.alienSpeedPxPerMs * dtMs }))
      .filter((b) => b.y < CONFIG.arena.h);
    const struck = s.invulnMs <= 0 && moved.some((b) => aabb(b, s.player));
    if (struck) {
      s = { ...s, alienBullets: [], lives: s.lives - 1, invulnMs: CONFIG.respawnInvulnMs };
      events.push({ type: "playerHit" });
      events.push({ type: "lifeLost" });
    } else {
      s = { ...s, alienBullets: moved };
    }
  }

  // ── Resolve end-of-frame conditions ──
  if (s.lives <= 0) {
    return finalize(s);
  }
  const alive = s.aliens.filter((a) => a.alive);
  if (alive.some((a) => a.y + a.h >= s.player.y)) {
    return finalize(s);
  }
  if (alive.length === 0) {
    const nextWave = s.wave + 1;
    s = {
      ...s,
      wave: nextWave,
      aliens: spawnWave(nextWave).aliens,
      dir: 1,
      stepAccumMs: 0,
      playerBullets: [],
      fireCd: 0,
      alienBullets: [],
    };
    events.push({ type: "waveCleared" });
  }

  return s;
}
