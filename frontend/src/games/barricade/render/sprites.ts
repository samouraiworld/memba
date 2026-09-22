/**
 * The sprite seam (GDD-v2 §5, Track 2): the game-only art loader registers
 * finished chassis images here and `drawMachine` swaps them in. Death-fling,
 * interpolation, telegraphs and mode pips keep working behind the same
 * (x, y, size) contract. Without loaded art every machine stays procedural;
 * jsdom renderer tests exercise that fallback.
 *
 * CONTRACT NOTE for additions: the sprite path returns BEFORE the
 * shape grammar, so any machine whose procedural case carries a LOAD-BEARING
 * state tell must ship variant art or stay procedural — today that is the
 * MARSHAL (its pavise visibly lowers in the open window; a single static
 * sprite would erase the timing telegraph). The panopticon is safe: its mode
 * pips draw outside drawMachine.
 */

import type { ArchetypeId } from "../sim/types"

const registry = new Map<ArchetypeId, CanvasImageSource>()

/** Hand the seam a finished plate (called by the game art loader). */
export function registerSprite(kind: ArchetypeId, img: CanvasImageSource): void {
    registry.set(kind, img)
}

/** The registered art for a machine, or null → draw procedurally. */
export function spriteFor(kind: ArchetypeId): CanvasImageSource | null {
    return registry.get(kind) ?? null
}

/** Test hook: back to an all-procedural world. */
export function clearSprites(): void {
    registry.clear()
}
