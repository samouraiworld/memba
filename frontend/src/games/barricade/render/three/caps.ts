/**
 * caps.ts — the BARRICADE renderer switch (Phase 0, PR-0b).
 *
 * Decides 2D vs 3D from four inputs: the build flag (VITE_ENABLE_BARRICADE_3D),
 * a runtime ?r3d / localStorage override, WebGL2 availability, and lite-mode.
 * The DECISION is a pure function (exhaustively unit-tested in caps.test.ts);
 * only the thin capability probes touch the DOM.
 *
 * NOTE: the 3D renderer itself does not exist until PR-0c, so nothing wires
 * resolveRenderer() into the game yet — this lands the switch + its tests first.
 */
import { isBarricade3DEnabled } from "../../../../lib/config"

export type RendererKind = "2d" | "3d"
export type RendererOverride = "on" | "off" | null

export interface RendererInputs {
    flagEnabled: boolean
    override: RendererOverride
    has3D: boolean
    liteMode: boolean
}

/**
 * Pure renderer decision.
 * - `has3D` (WebGL2) is a HARD gate — 3D is impossible without it, so nothing
 *   overrides it (a WebGL1-only / headless device always gets 2D).
 * - an explicit runtime override is authoritative over BOTH the flag and
 *   lite-mode: its whole purpose is deliberate opt-in/out for the owner + a beta
 *   cohort on prod (incl. on a lite device, to actually see 3D there).
 * - otherwise the flag decides, suppressed on lite/low-end devices.
 */
export function decideRenderer({ flagEnabled, override, has3D, liteMode }: RendererInputs): RendererKind {
    if (!has3D) return "2d"
    if (override === "on") return "3d"
    if (override === "off") return "2d"
    return flagEnabled && !liteMode ? "3d" : "2d"
}

/** Parse the runtime override: ?r3d=1|0 (URL wins) else localStorage "1"|"0". */
export function parseOverride(search: string, storageValue: string | null): RendererOverride {
    const q = new URLSearchParams(search).get("r3d")
    if (q === "1") return "on"
    if (q === "0") return "off"
    if (storageValue === "1") return "on"
    if (storageValue === "0") return "off"
    return null
}

const OVERRIDE_STORAGE_KEY = "barricade_r3d"

/** Read the override from the live browser (URL + localStorage). SSR/test-safe. */
export function readRuntimeOverride(): RendererOverride {
    if (typeof window === "undefined") return null
    let stored: string | null = null
    try {
        stored = window.localStorage.getItem(OVERRIDE_STORAGE_KEY)
    } catch {
        /* localStorage can throw in privacy mode — treat as absent */
    }
    return parseOverride(window.location.search, stored)
}

/** WebGL2 capability probe via a throwaway context. false in SSR/jsdom. */
export function detectHas3D(): boolean {
    if (typeof document === "undefined") return false
    try {
        return !!document.createElement("canvas").getContext("webgl2")
    } catch {
        return false
    }
}

/**
 * The live renderer decision for the barricade route. Composes the flag reader,
 * the runtime override, and the WebGL2 probe. `liteMode` detection (low-end /
 * battery) is a Phase-5 concern (the AdaptiveDpr/PerformanceMonitor ladder); it
 * is passed false here so the switch is honest today and gains the real signal
 * without an interface change.
 */
export function resolveRenderer(): RendererKind {
    return decideRenderer({
        flagEnabled: isBarricade3DEnabled(),
        override: readRuntimeOverride(),
        has3D: detectHas3D(),
        liteMode: false, // TODO(Phase 5): wire the low-end/battery lite-mode detector
    })
}
