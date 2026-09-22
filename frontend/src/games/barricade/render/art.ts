import { registerSprite } from "./sprites"

export type ScenePlate = "paris" | "citizen" | "broadcast"
const sceneArt = new Map<ScenePlate, HTMLImageElement>()
let started = false

/** Register a decoded scene plate; exported as the asset seam and test hook. */
export function registerScenePlate(key: ScenePlate, image: HTMLImageElement): void {
    sceneArt.set(key, image)
    if (key === "broadcast") registerSprite("broadcast", image)
}

/** Load only when BARRICADE mounts; the sim and replay never depend on art. */
export function loadBarricadeArt(): void {
    if (started || typeof Image === "undefined") return
    started = true

    const scene: Record<ScenePlate, string> = {
        paris: "paris-dusk",
        citizen: "citizen",
        broadcast: "broadcast",
    }
    for (const [key, file] of Object.entries(scene) as [ScenePlate, string][]) {
        const image = new Image()
        image.decoding = "async"
        image.onload = () => registerScenePlate(key, image)
        image.src = `/games/barricade/${file}.webp`
    }

    // These four chassis have no state-dependent shape tell. Marshal and the
    // rest retain their procedural art until suitable variants are supplied.
    for (const kind of ["drone", "walker", "testudo", "mortar"] as const) {
        const image = new Image()
        image.decoding = "async"
        image.onload = () => registerSprite(kind, image)
        image.src = `/games/barricade/${kind}.webp`
    }
}

export function scenePlate(key: ScenePlate): HTMLImageElement | null {
    return sceneArt.get(key) ?? null
}

/** Test hook: restore the unloaded state without changing the sprite registry. */
export function clearScenePlates(): void {
    sceneArt.clear()
    started = false
}
