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

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEvent, initState, tick } from "./sim/engine"
import { buildWaves, WAVE_TOTAL, type WaveScript } from "./sim/waves"
import { runReplay } from "./sim/replay"
import { LANES, type Choice, type SimEvent, type SimState } from "./sim/types"
import { draw, drawAttract } from "./render/draw"
import { deriveFxEvents } from "./render/fxEvents"
import { initFx, layout, pushFxEvents, stepFx, type FxState } from "./render/fx"
import { interpPositions } from "./render/interp"
import { buildShareText } from "./render/sharecard"
import { GameAudio } from "./render/audio"
import { useGameLoop } from "./hooks/useGameLoop"
import "./barricade.css"

// Logical canvas coordinate space; the backing store is scaled by devicePixelRatio.
const CW = 390
const CH = 650

type RunStatus = "ready" | "playing" | "done"
type HudMirror = { phase: string; rallyReady: boolean; scrap: number }
// Omit over a discriminated union collapses to common members — distribute it.
type SimEventInput = { type: "move"; lane: number } | { type: "rally" } | { type: "choice"; choice: Choice }

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
function prepCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1)
    const bw = Math.round(CW * dpr)
    const bh = Math.round(CH * dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export default function Barricade() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
    const [isDaily, setIsDaily] = useState(true)
    const [muted, setMuted] = useState(true)
    const [copied, setCopied] = useState(false)
    const [hud, setHud] = useState<HudMirror>({ phase: "wave", rallyReady: false, scrap: 0 })
    const [result, setResult] = useState<{
        score: number
        won: boolean
        waves: number
        verified: boolean
    } | null>(null)

    useEffect(() => {
        const audio = new GameAudio(true)
        audioRef.current = audio
        return () => {
            audio.close()
            audioRef.current = null
        }
    }, [])

    useEffect(() => {
        audioRef.current?.setMuted(muted)
    }, [muted])

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
        setResult(null)
        setStatus("playing")
    }, [])

    const record = useCallback((ev: SimEventInput) => {
        const s = stateRef.current
        if (s.phase === "won" || s.phase === "lost") return
        const stamped = { ...ev, tick: s.tick } as SimEvent
        eventsRef.current.push(stamped)
        stateRef.current = applyEvent(s, stamped)
    }, [])

    const onSteps = useCallback(
        (steps: number) => {
            let s = stateRef.current
            let prevTick = s
            for (let i = 0; i < steps; i++) {
                prevTick = s
                s = tick(s, wavesRef.current)
                if (s.phase === "won" || s.phase === "lost") break
            }
            stateRef.current = s
            // The state one tick back is the interpolation anchor for onFrame.
            tickPrevRef.current = prevTick
            if (s.phase === "won" || s.phase === "lost") {
                const replay = runReplay(seedRef.current, eventsRef.current)
                setResult({
                    score: s.score,
                    won: s.phase === "won",
                    waves: Math.min(s.wave + 1, WAVE_TOTAL),
                    // The recorded log must reproduce the live run exactly —
                    // this is the same check the server verifier performs.
                    verified: replay.score === s.score && replay.won === (s.phase === "won"),
                })
                setStatus("done")
            }
        },
        [],
    )

    const onFrame = useCallback((alpha: number) => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        prepCanvas(canvas, ctx)
        const s = stateRef.current
        const fx = fxRef.current
        const events = deriveFxEvents(prevStateRef.current, s)
        if (events.length > 0) {
            const lay = layout(CW, CH)
            const audio = audioRef.current
            // Fold events one at a time so the audio pitch reads the combo AS OF
            // each kill (a batch would replay the final pitch for the whole frame).
            for (const ev of events) {
                pushFxEvents(fx, [ev], lay)
                audio?.onFxEvent(ev, fx.combo)
            }
        }
        stepFx(fx)
        // Smooth enemy motion between fixed 60Hz ticks — render-only, so the sim
        // and its replay are untouched. tickPrevRef is the state one tick back;
        // alpha is this frame's fraction of the way to the current tick.
        const interp = interpPositions(tickPrevRef.current, s, alpha)
        draw(ctx, s, { width: CW, height: CH }, fx, interp)
        prevStateRef.current = s
    }, [])

    useGameLoop(status === "playing", onSteps, onFrame)

    // Attract / idle scene on the ready screen — the game at rest, so the first
    // thing a player sees is alive, not a dead black box. Render-only.
    useEffect(() => {
        if (status !== "ready") return
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        const rm = prefersReducedMotion()
        const t0 = performance.now()
        let raf = 0
        const paint = (now: number) => {
            prepCanvas(canvas, ctx)
            drawAttract(ctx, { width: CW, height: CH }, (now - t0) / 1000, rm)
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
            setHud({ phase: s.phase, rallyReady: s.rallyMeter >= 1000, scrap: s.scrap })
        }, 200)
        return () => clearInterval(t)
    }, [status])

    const onCanvasPointer = useCallback(
        (e: React.PointerEvent<HTMLCanvasElement>) => {
            if (status !== "playing") return
            const rect = e.currentTarget.getBoundingClientRect()
            const lane = Math.min(LANES - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * LANES)))
            record({ type: "move", lane })
        },
        [record, status],
    )

    const choose = useCallback((choice: Choice) => record({ type: "choice", choice }), [record])

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
            date: dailySeed().slice(-10),
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
        <div className="bar-shell">
            <header className="bar-wordmark">
                <span className="bar-eyebrow">Daily run · Season 0</span>
                <h1 className="bar-title">
                    MEMBA: <span className="bar-title__accent">BARRICADE</span>
                </h1>
            </header>

            <div className="bar-stage">
                <canvas
                    ref={canvasRef}
                    className="bar-canvas"
                    aria-label="Barricade play area"
                    onPointerDown={onCanvasPointer}
                />
            </div>

            {status === "ready" && (
                <div className="bar-panel">
                    <p className="bar-hint">
                        Hold the line to the Broadcast Tower — {WAVE_TOTAL} waves. Tap a lane to move your
                        rebel; kills fill the rally meter; between waves, spend scrap on repairs, a turret,
                        or arming the crowd. Same daily seed for everyone.
                    </p>
                    <div className="bar-controls">
                        <button className="k-btn-primary" onClick={() => start(true)}>
                            Daily run
                        </button>
                        <button className="k-btn-secondary" onClick={() => start(false)}>
                            Practice
                        </button>
                    </div>
                </div>
            )}

            {status === "playing" && (
                <div className="bar-controls">
                    <button
                        className={`k-btn-primary${hud.rallyReady ? " bar-rally-ready" : ""}`}
                        disabled={!hud.rallyReady}
                        onClick={() => record({ type: "rally" })}
                    >
                        Rally!
                    </button>
                    <button
                        className="k-btn-secondary"
                        aria-pressed={!muted}
                        aria-label={muted ? "Turn sound on" : "Turn sound off"}
                        onClick={toggleMute}
                    >
                        {muted ? "🔇" : "🔊"}
                    </button>
                    {hud.phase === "choice" && (
                        <>
                            <button className="bar-choice" onClick={() => choose("repair")}>
                                Repair
                            </button>
                            <button className="bar-choice" disabled={hud.scrap < 40} onClick={() => choose("turret")}>
                                Turret <span className="bar-choice__cost">◆ 40</span>
                            </button>
                            <button className="bar-choice" disabled={hud.scrap < 30} onClick={() => choose("arm")}>
                                Arm crowd <span className="bar-choice__cost">◆ 30</span>
                            </button>
                        </>
                    )}
                </div>
            )}

            {status === "done" && result && (
                <div className="bar-poster">
                    <p className="bar-poster__eyebrow">Memba · Barricade · {dailySeed().slice(-10)}</p>
                    <h2 className={`bar-poster__verdict ${result.won ? "is-won" : "is-lost"}`}>
                        {result.won ? "THE LINE HELD" : "THE LINE FELL"}
                    </h2>
                    <div className="bar-poster__score">{result.score.toLocaleString()}</div>
                    <p className="bar-poster__stats">
                        <span>
                            WAVE <strong>{result.waves}/{WAVE_TOTAL}</strong>
                        </span>
                        <span className="bar-poster__dot">·</span>
                        <span className={result.verified ? "bar-verified" : "bar-mismatch"}>
                            {result.verified ? "VERIFIED ✓" : "MISMATCH"}
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
                </div>
            )}
        </div>
    )
}
