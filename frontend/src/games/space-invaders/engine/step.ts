import { CONFIG } from "./config";
import type { GameState, InputIntent } from "./types";

// Tracks whether the previous frame's pause was held, to detect a rising edge.
// Encoded in phase transitions rather than extra state: we treat any frame with
// pause:true as a toggle request and debounce via a module-free approach —
// callers send pause:true for a single frame (the keyboard/touch hooks below
// emit an edge). To stay pure, we toggle whenever pause is true.
export function step(state: GameState, dtMs: number, input: InputIntent): GameState {
  let s = { ...state };

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

  return s;
}
