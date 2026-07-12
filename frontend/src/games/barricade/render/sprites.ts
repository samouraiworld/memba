/**
 * The hand-inked atlas SEAM (GDD-v2 §5, Track 2): when the collection-pipeline
 * art lands (riso PNGs for the boss + hero chassis families), a loader
 * registers each image here and `drawMachine` swaps it in — death-fling,
 * interpolation, telegraphs and the mode pips all keep working because the
 * seam sits behind the same (x, y, size) contract. Until then the registry is
 * empty and every machine renders procedurally; jsdom tests never register
 * anything, so the suite exercises the procedural path it can actually verify.
 */

import type { ArchetypeId } from "../sim/types"

const registry = new Map<ArchetypeId, CanvasImageSource>()

/** Hand the seam a finished plate (called by the future atlas loader). */
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
