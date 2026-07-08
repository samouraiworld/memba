import { CONFIG, formationStepMs } from "./config";
import type { GameState, GameEvent, InputIntent } from "./types";
import { aabb } from "./collision";
import { rngFloat } from "./prng";
import { spawnWave } from "./spawn";

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

  // Fire: spawn one bullet if none is live.
  if (input.fire && !s.playerBullet) {
    const bx = s.player.x + s.player.w / 2 - CONFIG.bullet.w / 2;
    s = {
      ...s,
      playerBullet: {
        x: bx,
        y: s.player.y - CONFIG.bullet.h,
        w: CONFIG.bullet.w,
        h: CONFIG.bullet.h,
        alive: true,
      },
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

  // Advance the player bullet and resolve alien hits.
  if (s.playerBullet) {
    const b = { ...s.playerBullet, y: s.playerBullet.y - CONFIG.bullet.playerSpeedPxPerMs * dtMs };
    if (b.y + b.h < 0) {
      s = { ...s, playerBullet: null };
    } else {
      let hitScore = 0;
      let hit = false;
      let killed: { x: number; y: number; row: number } | null = null;
      const aliens = s.aliens.map((a) => {
        if (!hit && a.alive && aabb(b, a)) {
          hit = true;
          hitScore = CONFIG.points[a.row] ?? CONFIG.points[CONFIG.points.length - 1];
          killed = { x: a.x, y: a.y, row: a.row };
          return { ...a, alive: false };
        }
        return a;
      });
      if (hit && killed) {
        s = { ...s, aliens, playerBullet: null, score: s.score + hitScore };
        events.push({ type: "alienKilled", ...(killed as { x: number; y: number; row: number }) });
      } else {
        s = { ...s, playerBullet: b };
      }
    }
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
    return { ...s, phase: "gameover" };
  }
  const alive = s.aliens.filter((a) => a.alive);
  if (alive.some((a) => a.y + a.h >= s.player.y)) {
    return { ...s, phase: "gameover" };
  }
  if (alive.length === 0) {
    const nextWave = s.wave + 1;
    s = {
      ...s,
      wave: nextWave,
      aliens: spawnWave(nextWave).aliens,
      dir: 1,
      stepAccumMs: 0,
      playerBullet: null,
      alienBullets: [],
    };
    events.push({ type: "waveCleared" });
  }

  return s;
}
