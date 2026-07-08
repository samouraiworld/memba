import { type RefObject } from "react";
import { CONFIG } from "../engine";

// Presentational only. Drawing is owned by the rAF loop (see draw.ts), which
// renders from the mutable state ref + fx layer every frame — decoupled from
// React state so 60fps paints don't go through reconciliation.
export function Canvas({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  return (
    <canvas
      ref={canvasRef}
      width={CONFIG.arena.w}
      height={CONFIG.arena.h}
      className="si-canvas"
      aria-label="Space Invaders play area"
    />
  );
}
