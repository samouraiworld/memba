/**
 * MEMBA: BARRICADE — playable shell (Memba-native visual pass).
 *
 * The sim lives entirely in refs (60 canvas paints/sec never touch React);
 * React state only carries the run lifecycle + a low-frequency HUD mirror for
 * the DOM buttons. Every player action is recorded as a SimEvent — the input
 * log IS the run, and the results screen re-verifies it through runReplay
 * (the same code path the G3 server verifier will use).
 *
 * The juice + render layer (screenshake, particles, silhouettes, the attract
 * idle scene) is derived from the sim each frame and painted in render loops
 * ONLY — it never feeds back into the sim or the input log, so it cannot change
 * a replay (see render/fx.parity.test).
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { isBarricade25DEnabled, isBarricadeCertifyEnabled } from "../../lib/config"
import { applyEvent, initState, tick } from "./sim/engine"
import { BOSS_WAVE, buildWaves, WAVE_TOTAL, type WaveScript } from "./sim/waves"
import { MAX_REPLAY_EVENTS, runReplay } from "./sim/replay"
import { BARRICADE_MAX_HP, LANES, LANE_LENGTH, TICKS_PER_SECOND, type Choice, type SimEvent, type SimState } from "./sim/types"
import { ARM_COST, MOLOTOV_COST, MOLOTOV_MAX, REFILL_COST, REPAIR_COST, TURRET_COST } from "./sim/engine"
import { draw, drawAttract } from "./render/draw"
import { draw25d, screenToLaneDist25d } from "./render/draw25d"
import { loadBarricadeArt } from "./render/art"
import { resolveRenderer } from "./render/three/caps"
import { useSimSnapshots } from "./render/three/bridge/useSimSnapshots"
import { deriveFxEvents } from "./render/fxEvents"
import { initFx, layout, pushFxEvents, stepFx, type FxState } from "./render/fx"
import { interpPositions } from "./render/interp"
import { buildShareText } from "./render/sharecard"
import { GameAudio } from "./render/audio"
import { useGameLoop } from "./hooks/useGameLoop"
import "./barricade.css"

// The on-chain certify control is a lazy chunk: it pulls in the wallet hooks, so
// it must never load on the no-wallet play path (only when the flag is on and a
// verified daily run is on the poster).
const BarricadeCertify = lazy(() => import("./BarricadeCertify"))
// Lazy so the three / react-three-fiber stack lands in the async vendor-three chunk
// (bundle CI gate + Workbox precache-exclusion enforce it), never the eager bundle.
const Barricade3D = lazy(() => import("./render/three/Barricade3D"))

// Logical canvas coordinate space; the backing store is scaled by devicePixelRatio.
const CW = 390
const CH = 650

// Phase-0 bake-off: the 2.5D comparator renderer (arm A). The desktop front-line
// view is the default; compact screens retain the 2D fallback until the owner has
// compared them on a physical phone. Explicit URL/localStorage overrides still win.
function resolve25dRenderer(): boolean {
    // An explicit ?r25d / localStorage override wins over the env flag (deliberate
    // opt-in/out on prod, and so a side-by-side A/B is one URL apart).
    if (typeof window !== "undefined") {
        try {
            const q = new URLSearchParams(window.location.search).get("r25d")
            if (q === "1") return true
            if (q === "0") return false
            const ls = window.localStorage.getItem("barricade_r25d")
            if (ls === "1") return true
            if (ls === "0") return false
        } catch {
            /* privacy mode / no window — fall through to the flag */
        }
    }
    return isBarricade25DEnabled() || (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 769px) and (min-height: 600px)").matches)
}
const RENDER_25D = resolve25dRenderer()

// Phase-0 bake-off arm B: the real 3D renderer. resolveRenderer() folds the flag,
// the ?r3d override, and the WebGL2 probe (caps.ts), chosen once at module load. 3D
// takes precedence over the 2.5D comparator if both are somehow enabled.
const RENDER_3D = resolveRenderer() === "3d"

type RunStatus = "ready" | "playing" | "paused" | "done"
type HudMirror = {
    phase: string
    wave: number
    playerLane: number
    rallyReady: boolean
    molotovReady: boolean
    shoveReady: boolean
    shoveCooldownSeconds: number
    scrap: number
    patchUsed: boolean
    barricadeDamaged: boolean
    molotovBankFull: boolean
}
function projectHud(s: SimState): HudMirror {
    const shoveTicks = Math.max(0, s.shoveReadyAt - s.tick)
    return {
        phase: s.phase,
        wave: s.wave,
        playerLane: s.playerLane,
        rallyReady: s.rallyMeter >= 1000,
        molotovReady: s.molotovCharge >= MOLOTOV_COST && s.tick >= s.molotovReadyAt,
        shoveReady: shoveTicks === 0 && s.enemies.some((enemy) => enemy.lane === s.playerLane),
        shoveCooldownSeconds: Math.ceil(shoveTicks / TICKS_PER_SECOND),
        scrap: s.scrap,
        patchUsed: s.patchUsed,
        barricadeDamaged: s.barricadeHp < BARRICADE_MAX_HP,
        molotovBankFull: s.molotovCharge >= MOLOTOV_MAX,
    }
}
// Omit over a discriminated union collapses to common members — distribute it.
type SimEventInput =
    | { type: "move"; lane: number }
    | { type: "rally" }
    | { type: "choice"; choice: Choice }
    | { type: "throw"; lane: number; dist: number }
    | { type: "shove"; lane: number }

function dailySeed(): string {
    return `barricade-${new Date().toISOString().slice(0, 10)}`
}

function prefersReducedMotion(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
}

/** Size the backing store to device pixels (crisp on retina) and draw in CSS px. */
function prepCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, view: { width: number; height: number }): void {
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1)
    const bw = Math.round(view.width * dpr)
    const bh = Math.round(view.height * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export default function Barricade() {
    const shellRef = useRef<HTMLDivElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const stageRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef({ width: CW, height: CH })
    const resultHeadingRef = useRef<HTMLHeadingElement | null>(null)
    const stateRef = useRef<SimState>(initState("idle"))
    const wavesRef = useRef<WaveScript[]>(buildWaves("idle"))
    const eventsRef = useRef<SimEvent[]>([])
    const seedRef = useRef("")
    const practiceCounter = useRef(0)
    const fxRef = useRef<FxState>(initFx(prefersReducedMotion()))
    // Seeded with its own idle state (never read another ref during render); the
    // real previous-frame state is set in start() and updated each onFrame.
    const prevStateRef = useRef<SimState>(initState("idle"))
    // The sim state one tick before the current one — the anchor for sub-tick
    // position interpolation so enemy motion stays smooth above 60Hz.
    const tickPrevRef = useRef<SimState>(initState("idle"))
    const audioRef = useRef<GameAudio | null>(null)

    const [status, setStatus] = useState<RunStatus>("ready")
    const [canFullscreen, setCanFullscreen] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [fullscreenError, setFullscreenError] = useState("")
    const [isDaily, setIsDaily] = useState(true)
    const [muted, setMuted] = useState(true)
    const [copied, setCopied] = useState(false)
    const [armed, setArmed] = useState(false) // molotov aim mode: next canvas tap lobs
    const [aim, setAim] = useState({ lane: 0, dist: Math.round(LANE_LENGTH / 2) })
    const [hud, setHud] = useState<HudMirror>(() => projectHud(initState("idle")))
    const [result, setResult] = useState<{
        score: number
        won: boolean
        waves: number
        overtimeRound: number
        verified: boolean
        stateHash: string
        simVersion: number
        seed: string
        events: SimEvent[]
    } | null>(null)

    useEffect(() => {
        if (RENDER_25D && !RENDER_3D) loadBarricadeArt()
    }, [])

    useEffect(() => {
        const audio = new GameAudio(true)
        audioRef.current = audio
        return () => {
            audio.close()
            audioRef.current = null
        }
    }, [])

    useEffect(() => {
        audioRef.current?.setMuted(muted || status === "paused")
    }, [muted, status])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const updateSize = (width: number, height: number) => {
            if (width > 0 && height > 0) {
                viewRef.current = { width: Math.round(width), height: Math.round(height) }
                if (status === "paused") {
                    const ctx = canvas.getContext("2d")
                    if (ctx) {
                        prepCanvas(canvas, ctx, viewRef.current)
                        if (RENDER_25D) draw25d(ctx, stateRef.current, viewRef.current, fxRef.current)
                        else draw(ctx, stateRef.current, viewRef.current, fxRef.current)
                    }
                }
            }
        }
        updateSize(canvas.clientWidth, canvas.clientHeight)
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => {
            updateSize(entry.contentRect.width, entry.contentRect.height)
        })
        observer.observe(canvas)
        return () => observer.disconnect()
    }, [status])

    useEffect(() => {
        setCanFullscreen(Boolean(shellRef.current?.requestFullscreen && document.fullscreenEnabled))
        const onFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === shellRef.current)
            setFullscreenError("")
        }
        document.addEventListener("fullscreenchange", onFullscreenChange)
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
    }, [])

    const toggleFullscreen = useCallback(async () => {
        const shell = shellRef.current
        if (!shell) return
        try {
            if (document.fullscreenElement === shell) await document.exitFullscreen()
            else await shell.requestFullscreen()
            if (status === "playing") stageRef.current?.focus()
        } catch {
            setFullscreenError("Fullscreen could not start in this browser.")
        }
    }, [status])

    useEffect(() => {
        const pauseIfPlaying = () => setStatus((current) => current === "playing" ? "paused" : current)
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") pauseIfPlaying()
        }
        window.addEventListener("blur", pauseIfPlaying)
        document.addEventListener("visibilitychange", onVisibilityChange)
        return () => {
            window.removeEventListener("blur", pauseIfPlaying)
            document.removeEventListener("visibilitychange", onVisibilityChange)
        }
    }, [])

    useEffect(() => {
        if (status === "done") resultHeadingRef.current?.focus()
    }, [status])

    const start = useCallback((daily: boolean) => {
        const seed = daily ? dailySeed() : `practice-${Date.now()}-${practiceCounter.current++}`
        seedRef.current = seed
        stateRef.current = initState(seed)
        wavesRef.current = buildWaves(seed)
        eventsRef.current = []
        fxRef.current = initFx(prefersReducedMotion())
        prevStateRef.current = stateRef.current
        tickPrevRef.current = stateRef.current
        setIsDaily(daily)
        setArmed(false)
        setAim({ lane: 0, dist: Math.round(LANE_LENGTH / 2) })
        setHud(projectHud(stateRef.current))
        setResult(null)
        setStatus("playing")
        stageRef.current?.focus()
    }, [])

    const record = useCallback((ev: SimEventInput) => {
        const s = stateRef.current
        if (s.phase === "lost") return
        // The replay truncates at MAX_REPLAY_EVENTS (verifier cost bound), so
        // stop recording AND applying at the same cap — live play and the
        // re-verified log must never disagree. Unreachable by human tapping.
        if (eventsRef.current.length >= MAX_REPLAY_EVENTS) return
        const stamped = { ...ev, tick: s.tick } as SimEvent
        eventsRef.current.push(stamped)
        const next = applyEvent(s, stamped)
        stateRef.current = next
        // Player actions are infrequent enough to mirror immediately. This keeps
        // cooldowns and shop affordability honest instead of leaving a 200ms
        // window where an action looks available but the sim will reject it.
        setHud(projectHud(next))
    }, [])

    const onSteps = useCallback(
        (steps: number) => {
            let s = stateRef.current
            let prevTick = s
            for (let i = 0; i < steps; i++) {
                prevTick = s
                s = tick(s, wavesRef.current)
                if (s.phase === "lost") break
            }
            stateRef.current = s
            // The state one tick back is the interpolation anchor for onFrame.
            tickPrevRef.current = prevTick
            if (s.phase === "lost") {
                // Every run ends "lost" now (the siege always wins eventually);
                // holding the line = the terminal wave got past the boss.
                const wonArc = s.wave > BOSS_WAVE
                const replay = runReplay(seedRef.current, eventsRef.current)
                setResult({
                    score: s.score,
                    won: wonArc,
                    waves: Math.min(s.wave + 1, WAVE_TOTAL),
                    overtimeRound: Math.max(0, s.wave - BOSS_WAVE),
                    // The recorded log must reproduce the live run exactly —
                    // this is the same check the server verifier performs.
                    verified: replay.score === s.score && replay.won === wonArc,
                    // Carried for the opt-in on-chain certify claim (the server
                    // re-simulates and must match these). Snapshotted into state
                    // here (not read from refs during render — refs are unstable
                    // and reading them in JSX trips react-hooks/refs).
                    stateHash: replay.stateHash,
                    simVersion: replay.simVersion,
                    seed: seedRef.current,
                    events: eventsRef.current.slice(),
                })
                setStatus("done")
            }
        },
        [],
    )

    const snapStore = useSimSnapshots()

    const onFrame = useCallback(
        (alpha: number) => {
            const s = stateRef.current
            const fx = fxRef.current
            const view = viewRef.current
            const events = deriveFxEvents(prevStateRef.current, s)
            if (events.length > 0) {
                const lay = layout(view.width, view.height)
                const audio = audioRef.current
                // Fold events one at a time so the audio pitch reads the combo AS OF
                // each kill (a batch would replay the final pitch for the whole frame).
                for (const ev of events) {
                    pushFxEvents(fx, [ev], lay)
                    audio?.onFxEvent(ev, fx.combo)
                }
            }
            stepFx(fx)
            // 3D: publish the two latest sim states + sub-tick alpha for the R3F scene
            // to read in its own loop. The sim still advances in exactly ONE place
            // (useGameLoop → onSteps); this is a pure read-side handoff, no 2D canvas.
            if (RENDER_3D) {
                snapStore.publish(tickPrevRef.current, s, alpha)
                prevStateRef.current = s
                return
            }
            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            if (!canvas || !ctx) return
            prepCanvas(canvas, ctx, view)
            // Smooth enemy motion between fixed 60Hz ticks — render-only, so the sim
            // and its replay are untouched. tickPrevRef is the state one tick back;
            // alpha is this frame's fraction of the way to the current tick.
            const interp = interpPositions(tickPrevRef.current, s, alpha)
            if (RENDER_25D) draw25d(ctx, s, view, fx, interp)
            else draw(ctx, s, view, fx, interp)
            prevStateRef.current = s
        },
        [snapStore],
    )

    useGameLoop(status === "playing", onSteps, onFrame)

    // Attract / idle scene on the ready screen — the game at rest, so the first
    // thing a player sees is alive, not a dead black box. Render-only.
    useEffect(() => {
        if (status !== "ready") return
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        const rm = prefersReducedMotion()
        const idle = initState("idle")
        const t0 = performance.now()
        let raf = 0
        const paint = (now: number) => {
            const view = viewRef.current
            prepCanvas(canvas, ctx, view)
            if (RENDER_25D) {
                draw25d(ctx, { ...idle, tick: Math.floor((now - t0) / 16) }, view, undefined, undefined, true)
            } else {
                drawAttract(ctx, view, (now - t0) / 1000, rm)
            }
            raf = requestAnimationFrame(paint)
        }
        raf = requestAnimationFrame(paint)
        return () => cancelAnimationFrame(raf)
    }, [status])

    // Low-frequency HUD mirror for the DOM buttons (never per-frame setState).
    useEffect(() => {
        if (status !== "playing") return
        const t = setInterval(() => {
            const s = stateRef.current
            setHud(projectHud(s))
        }, 200)
        return () => clearInterval(t)
    }, [status])

    const onCanvasPointer = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (status !== "playing") return
            const rect = e.currentTarget.getBoundingClientRect()
            const view = viewRef.current
            const canvasX = ((e.clientX - rect.left) / rect.width) * view.width
            const canvasY = ((e.clientY - rect.top) / rect.height) * view.height
            const target = RENDER_25D
                ? screenToLaneDist25d(view, canvasX, canvasY)
                : {
                    lane: Math.min(LANES - 1, Math.max(0, Math.floor((canvasX / view.width) * LANES))),
                    dist: Math.round(Math.max(0, Math.min(1, (canvasY - layout(view.width, view.height).hudH) / layout(view.width, view.height).fieldH)) * LANE_LENGTH),
                }
            if (!target) return
            if (armed) {
                // Tap-to-lob: the tap's y is the target distance up the lane
                // (top = spawn end, bottom = barricade). One throw, then disarm.
                record({ type: "throw", lane: target.lane, dist: target.dist })
                setArmed(false)
            } else {
                record({ type: "move", lane: target.lane })
            }
        },
        [record, status, armed],
    )

    // 3D ground tap → the SAME move/throw the 2D pointer records, from the raycast's
    // integer (lane, dist). Guarded to "playing" exactly like onCanvasPointer.
    const handleGroundTap = useCallback(
        (lane: number, dist: number) => {
            if (status !== "playing") return
            if (armed) {
                record({ type: "throw", lane, dist })
                setArmed(false)
            } else {
                record({ type: "move", lane })
            }
        },
        [record, status, armed],
    )

    const choose = useCallback((choice: Choice) => record({ type: "choice", choice }), [record])
    const shove = useCallback(() => {
        const s = stateRef.current
        if (s.tick < s.shoveReadyAt || !s.enemies.some((enemy) => enemy.lane === s.playerLane)) return
        record({ type: "shove", lane: s.playerLane })
    }, [record])
    const toggleArm = useCallback(() => {
        const s = stateRef.current
        if (!armed && (s.molotovCharge < MOLOTOV_COST || s.tick < s.molotovReadyAt)) return
        setAim({ lane: stateRef.current.playerLane, dist: Math.round(LANE_LENGTH / 2) })
        setArmed((a) => !a)
        stageRef.current?.focus()
    }, [armed])

    const onStageKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return
        const key = e.key.toLowerCase()
        if (status === "paused" && (key === "p" || key === "escape")) {
            e.preventDefault()
            setStatus("playing")
            return
        }
        if (status !== "playing") return
        if (key === "p") {
            e.preventDefault()
            setStatus("paused")
            return
        }
        if (armed) {
            const step = Math.max(1, Math.round(LANE_LENGTH / 10))
            if (key === "arrowleft" || key === "arrowright" || /^[1-3]$/.test(key)) {
                e.preventDefault()
                setAim((current) => ({ ...current, lane: /^[1-3]$/.test(key) ? Number(key) - 1 : Math.max(0, Math.min(LANES - 1, current.lane + (key === "arrowleft" ? -1 : 1))) }))
                return
            }
            if (key === "arrowup" || key === "arrowdown") {
                e.preventDefault()
                setAim((current) => ({ ...current, dist: Math.max(0, Math.min(LANE_LENGTH, current.dist + (key === "arrowdown" ? step : -step))) }))
                return
            }
            if (key === "enter" || key === " ") {
                e.preventDefault()
                record({ type: "throw", lane: aim.lane, dist: aim.dist })
                setArmed(false)
                return
            }
            if (key === "escape") {
                e.preventDefault()
                setArmed(false)
                return
            }
        }
        const currentLane = stateRef.current.playerLane
        let action: SimEventInput | null = null
        if (key === "arrowleft") action = { type: "move", lane: Math.max(0, currentLane - 1) }
        if (key === "arrowright") action = { type: "move", lane: Math.min(LANES - 1, currentLane + 1) }
        if (/^[1-3]$/.test(key)) action = { type: "move", lane: Number(key) - 1 }
        if (key === "r") action = { type: "rally" }
        if (key === "s") {
            e.preventDefault()
            shove()
            return
        }
        if (key === "m") {
            e.preventDefault()
            toggleArm()
            return
        }
        if (key === "escape") {
            e.preventDefault()
            setStatus("paused")
            return
        }
        if (!action) return
        e.preventDefault()
        record(action)
    }, [aim, armed, record, shove, status, toggleArm])

    const toggleMute = useCallback(() => {
        audioRef.current?.resume() // unlock the audio context inside the user gesture
        setMuted((m) => !m)
    }, [])

    // Copy a spoiler-free, Wordle-style share card to the clipboard — the growth
    // engine. Explicit tap only, never auto-shared. No-ops where clipboard is
    // unavailable (e.g. insecure context).
    const share = useCallback(() => {
        if (!result) return
        const text = buildShareText({
            score: result.score,
            won: result.won,
            waves: result.waves,
            total: WAVE_TOTAL,
            overtimeRound: result.overtimeRound,
            date: result.seed.slice(-10),
        })
        const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined
        if (!clip?.writeText) return
        clip.writeText(text).then(
            () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2000)
            },
            () => {},
        )
    }, [result])

    return (
        <div
            ref={shellRef}
            className={`bar-shell${status === "done" ? " bar-shell--done" : ""}`}
            data-renderer={RENDER_3D ? "3d" : RENDER_25D ? "2.5d" : "2d"}
        >
            <Link className="bar-exit bar-exit--compact" to="../.." relative="path">Exit game</Link>
            <header className="bar-wordmark">
                <div className="bar-wordmark__name">
                    <span className="bar-eyebrow">Daily run · Season 0</span>
                    <h1 className="bar-title">
                        MEMBA: <span className="bar-title__accent">BARRICADE</span>
                    </h1>
                </div>
                <div className="bar-wordmark__actions">
                    <Link className="bar-exit bar-exit--desktop" to="../.." relative="path">Exit game</Link>
                    {canFullscreen && (
                        <button
                            type="button"
                            className="bar-fullscreen"
                            aria-pressed={isFullscreen}
                            onClick={toggleFullscreen}
                        >
                            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                        </button>
                    )}
                </div>
            </header>
            {fullscreenError && <p className="bar-fullscreen-error" role="alert">{fullscreenError}</p>}

            <p id="bar-game-controls" className="bar-sr-only">
                Focus the playfield. Use left and right arrows or 1, 2, 3 to move lanes. R rallies, M aims a molotov, S shoves, and P pauses. While aiming, use arrows to choose lane and range, then Enter to throw.
            </p>
            <div
                ref={stageRef}
                className="bar-stage"
                role="group"
                tabIndex={0}
                aria-label="Barricade playfield"
                aria-describedby="bar-game-controls"
                onKeyDown={onStageKeyDown}
                onPointerDown={(e) => {
                    if (e.target === e.currentTarget || e.target instanceof HTMLCanvasElement) e.currentTarget.focus()
                }}
            >
                {RENDER_3D ? (
                    <Suspense fallback={<div className="bar-canvas" aria-label="Barricade play area" />}>
                        <Barricade3D store={snapStore} onGroundTap={handleGroundTap} />
                    </Suspense>
                ) : (
                    <canvas
                        ref={canvasRef}
                        className="bar-canvas"
                        aria-label="Barricade play area"
                        onPointerDown={onCanvasPointer}
                    />
                )}
                {status === "playing" && armed && (
                    <div className="bar-aim-hint" role="status">
                        Tap to throw · Keyboard: lane {aim.lane + 1}, range {Math.round(100 * aim.dist / LANE_LENGTH)}%. Arrows aim, Enter throws.
                    </div>
                )}
                {status === "paused" && (
                    <div className="bar-pause">
                        <strong>Run paused</strong>
                        <span>Your run is held until you resume.</span>
                        <button className="k-btn-primary" onClick={() => { setStatus("playing"); stageRef.current?.focus() }}>Resume run</button>
                    </div>
                )}
                {status === "playing" && hud.phase === "choice" && (
                    <div className="bar-shop" role="group" aria-label="Between-wave shop">
                        <p className="bar-shop__title">Between waves <span>◆ {hud.scrap} scrap</span></p>
                        <div className="bar-shop__actions">
                            <button className="bar-choice" disabled={hud.scrap < REPAIR_COST || !hud.barricadeDamaged} onClick={() => choose("repair")}>
                                Repair <span className="bar-choice__cost">◆ {REPAIR_COST}</span>
                            </button>
                            {!hud.patchUsed && (
                                <button className="bar-choice" disabled={!hud.barricadeDamaged} onClick={() => choose("patch")}>
                                    Patch <span className="bar-choice__cost">free ×1</span>
                                </button>
                            )}
                            <button className="bar-choice" disabled={hud.scrap < TURRET_COST} onClick={() => choose("turret")}>
                                Turret <span className="bar-choice__cost">◆ {TURRET_COST}</span>
                            </button>
                            <button className="bar-choice" disabled={hud.scrap < ARM_COST} onClick={() => choose("arm")}>
                                Arm crowd <span className="bar-choice__cost">◆ {ARM_COST}</span>
                            </button>
                            <button className="bar-choice" disabled={hud.scrap < REFILL_COST || hud.molotovBankFull} onClick={() => choose("refill")}>
                                Refill <span className="bar-choice__cost">◆ {REFILL_COST}</span>
                            </button>
                            <button className="bar-choice bar-choice--continue" onClick={() => choose("done")}>
                                To the wall →
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {status === "playing" && (
                <p className="bar-sr-only" role="status">
                    Wave {Math.min(hud.wave + 1, WAVE_TOTAL)} of {WAVE_TOTAL}. Lane {hud.playerLane + 1}. {hud.phase === "choice" ? "Choose an upgrade." : "Defend the wall."}
                </p>
            )}

            {status === "ready" && (
                <div className="bar-panel">
                    <div className="bar-controls bar-controls--start">
                        <button className="k-btn-primary" onClick={() => start(true)}>Daily run</button>
                        <button className="k-btn-secondary" onClick={() => start(false)}>Practice</button>
                    </div>
                    <p className="bar-hint">
                        At a Paris barricade, defend liberty and equal rights for {WAVE_TOTAL} waves. Tap a lane and you fire automatically;
                        shove its nearest machine or aim a molotov farther up the street. Defeated machines fill Rally and drop scrap for the
                        between-wave shop. Everyone gets the same daily seed. Practice runs do not count.
                    </p>
                </div>
            )}

            {status === "playing" && hud.phase !== "choice" && (
                <div className="bar-controls bar-controls--playing">
                    <button
                        className={`k-btn-primary${hud.rallyReady ? " bar-rally-ready" : ""}`}
                        disabled={!hud.rallyReady}
                        onClick={() => record({ type: "rally" })}
                    >
                        Rally!
                    </button>
                    <button
                        className={`k-btn-primary${armed ? " bar-rally-ready" : ""}`}
                        disabled={!hud.molotovReady && !armed}
                        aria-pressed={armed}
                        onClick={toggleArm}
                    >
                        {armed ? "Cancel aim" : "Molotov"}
                    </button>
                    <button
                        className="k-btn-secondary"
                        disabled={!hud.shoveReady}
                        aria-label={hud.shoveReady
                            ? "Shove the nearest machine"
                            : hud.shoveCooldownSeconds > 0
                                ? `Shove recharging, ${hud.shoveCooldownSeconds} seconds`
                                : "Shove unavailable, no machine in your lane"}
                        onClick={shove}
                    >
                        {hud.shoveCooldownSeconds > 0 ? `Shove ${hud.shoveCooldownSeconds}s` : "Shove"}
                    </button>
                    <button className="k-btn-secondary" onClick={() => { setStatus("paused"); stageRef.current?.focus() }}>
                        Pause
                    </button>
                    <button
                        className="k-btn-secondary"
                        aria-pressed={!muted}
                        aria-label={muted ? "Turn sound on" : "Turn sound off"}
                        onClick={toggleMute}
                    >
                        {muted ? "🔇" : "🔊"}
                    </button>
                </div>
            )}

            {status === "done" && result && (
                <div className="bar-poster">
                    <p className="bar-poster__eyebrow">Memba · Barricade · {isDaily ? result.seed.slice(-10) : "Practice"}</p>
                    <h2 ref={resultHeadingRef} tabIndex={-1} className={`bar-poster__verdict ${result.won ? "is-won" : "is-lost"}`}>
                        {result.won ? "THE LINE HELD" : "THE LINE FELL"}
                    </h2>
                    <div className="bar-poster__score">{result.score.toLocaleString()}</div>
                    <p className="bar-poster__stats">
                        <span>
                            WAVE <strong>{result.waves}/{WAVE_TOTAL}</strong>
                        </span>
                        {result.overtimeRound > 0 && (
                            <>
                                <span className="bar-poster__dot">·</span>
                                <span>
                                    SIEGE <strong>r{result.overtimeRound}</strong>
                                </span>
                            </>
                        )}
                        <span className="bar-poster__dot">·</span>
                        <span className={result.verified ? "bar-verified" : "bar-mismatch"}>
                            {result.verified ? "LOCAL REPLAY ✓" : "REPLAY MISMATCH"}
                        </span>
                    </p>
                    <p className="bar-hint">
                        {isDaily
                            ? "Season leaderboards and your Memba's abilities arrive with the full launch."
                            : "Practice run — scores don't count."}
                    </p>
                    <div className="bar-controls">
                        <button className="k-btn-primary" onClick={() => start(isDaily)}>
                            {isDaily ? "Run it again" : "New practice"}
                        </button>
                        {isDaily && (
                            <button className="k-btn-secondary" onClick={share}>
                                {copied ? "Copied ✓" : "Share"}
                            </button>
                        )}
                        <button className="k-btn-secondary" onClick={() => setStatus("ready")}>
                            Back
                        </button>
                    </div>
                    {isBarricadeCertifyEnabled() && isDaily && result.verified && (
                        <div className="bar-certify">
                            <Suspense fallback={null}>
                                <BarricadeCertify
                                    run={{
                                        seed: result.seed,
                                        simVersion: result.simVersion,
                                        events: result.events,
                                        claimedScore: result.score,
                                        claimedHash: result.stateHash,
                                    }}
                                />
                            </Suspense>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
