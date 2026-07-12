/**
 * MEMBA: BARRICADE — G1 playable shell + G2 "First Feel" juice.
 *
 * The sim lives entirely in refs (60 canvas paints/sec never touch React);
 * React state only carries the run lifecycle + a low-frequency HUD mirror for
 * the DOM buttons. Every player action is recorded as a SimEvent — the input
 * log IS the run, and the results screen re-verifies it through runReplay
 * (the same code path the G3 server verifier will use).
 *
 * The juice layer (screenshake, particles, flashes, sound) is derived from the
 * sim each frame and rendered in onFrame ONLY — it never feeds back into the
 * sim or the input log, so it cannot change a replay (see render/fx.parity.test).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEvent, initState, tick } from "./sim/engine"
import { buildWaves, WAVE_TOTAL, type WaveScript } from "./sim/waves"
import { runReplay } from "./sim/replay"
import { LANES, type Choice, type SimEvent, type SimState } from "./sim/types"
import { draw } from "./render/draw"
import { deriveFxEvents } from "./render/fxEvents"
import { initFx, layout, pushFxEvents, stepFx, type FxState } from "./render/fx"
import { GameAudio } from "./render/audio"
import { useGameLoop } from "./hooks/useGameLoop"
import "./barricade.css"

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
    const audioRef = useRef<GameAudio | null>(null)

    const [status, setStatus] = useState<RunStatus>("ready")
    const [isDaily, setIsDaily] = useState(true)
    const [muted, setMuted] = useState(true)
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
            for (let i = 0; i < steps; i++) {
                s = tick(s, wavesRef.current)
                if (s.phase === "won" || s.phase === "lost") break
            }
            stateRef.current = s
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

    const onFrame = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return
        const s = stateRef.current
        const fx = fxRef.current
        const events = deriveFxEvents(prevStateRef.current, s)
        if (events.length > 0) {
            pushFxEvents(fx, events, layout(canvas.width, canvas.height))
            const audio = audioRef.current
            if (audio) for (const ev of events) audio.onFxEvent(ev, fx.combo)
        }
        stepFx(fx)
        draw(ctx, s, { width: canvas.width, height: canvas.height }, fx)
        prevStateRef.current = s
    }, [])

    useGameLoop(status === "playing", onSteps, onFrame)

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

    return (
        <div className="bar-shell">
            <h1>MEMBA: BARRICADE</h1>

            {status === "ready" && (
                <div className="bar-results">
                    <p className="bar-hint">
                        Hold the line to the Broadcast Tower — {WAVE_TOTAL} waves. Tap a lane to
                        move your rebel; kills fill the rally meter; between waves, spend scrap on
                        repairs, a turret, or arming the crowd. Same daily seed for everyone.
                    </p>
                    <div className="bar-controls">
                        <button className="btn-primary" onClick={() => start(true)}>
                            Daily run
                        </button>
                        <button onClick={() => start(false)}>Practice</button>
                    </div>
                </div>
            )}

            <canvas
                ref={canvasRef}
                width={390}
                height={650}
                className="bar-canvas"
                aria-label="Barricade play area"
                onPointerDown={onCanvasPointer}
            />

            {status === "playing" && (
                <div className="bar-controls">
                    <button className="btn-primary" disabled={!hud.rallyReady} onClick={() => record({ type: "rally" })}>
                        Rally!
                    </button>
                    <button aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
                        {muted ? "Sound off" : "Sound on"}
                    </button>
                    {hud.phase === "choice" && (
                        <>
                            <button onClick={() => choose("repair")}>Repair</button>
                            <button disabled={hud.scrap < 40} onClick={() => choose("turret")}>
                                Turret (40)
                            </button>
                            <button disabled={hud.scrap < 30} onClick={() => choose("arm")}>
                                Arm crowd (30)
                            </button>
                        </>
                    )}
                </div>
            )}

            {status === "done" && result && (
                <div className="bar-results">
                    <h2>{result.won ? "THE LINE HELD" : "THE LINE FELL"}</h2>
                    <p>
                        Score <strong>{result.score}</strong> · waves {result.waves}/{WAVE_TOTAL} ·{" "}
                        {result.verified ? "run verified ✓" : "verification mismatch"}
                    </p>
                    <p className="bar-hint">
                        {isDaily
                            ? "Season leaderboards and your Memba's abilities arrive with the full launch."
                            : "Practice run — scores don't count."}
                    </p>
                    <div className="bar-controls">
                        <button className="btn-primary" onClick={() => start(isDaily)}>
                            {isDaily ? "Run it again" : "New practice"}
                        </button>
                        <button onClick={() => setStatus("ready")}>Back</button>
                    </div>
                </div>
            )}
        </div>
    )
}
