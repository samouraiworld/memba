/**
 * JitsiPiPOverlay — Persistent Jitsi iframe rendered as Layout sibling.
 *
 * Two visual modes:
 * - **expanded**: Full-screen modal overlay (same UX as old DAORooms modal)
 * - **pip**: Draggable mini-player (320×180, bottom-right corner)
 *
 * v2.13 CRITICAL FIX: ONE iframe, ONE container, CSS-only mode switching.
 * ─────────────────────────────────────────────────────────────────────
 * Previous version (v2.12) rendered TWO conditional branches, each with
 * its own <iframe>. React unmounted/remounted the iframe on mode switch,
 * destroying the WebRTC session → black screen + "Join Meeting" rejoin.
 *
 * Now: always-mounted container with stable iframe. Overlay backdrop,
 * modal chrome, and PiP controls are rendered alongside (not wrapping)
 * the iframe. CSS `position: fixed` + class toggle handles layout.
 *
 * Also fixes:
 * - Rename "PiP" → "Reduce" (user-facing label)
 * - Drag uses container ref for pointer capture (not e.target)
 * - Viewport boundary constraints on drag
 * - Tightened iframe `allow` (removed wildcard `*`)
 *
 * @module components/ui/JitsiPiPOverlay
 */

import { useEffect, useCallback, useRef, useState } from "react"
import { useJitsiContext } from "../../contexts/JitsiContext"
import "../dao/dao-rooms.css"

export function JitsiPiPOverlay() {
    const { session, displayMode, minimize, expand, leaveRoom } = useJitsiContext()
    const containerRef = useRef<HTMLDivElement>(null)

    // ── Drag state (PiP mode) ─────────────────────────────────
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
    const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
    const [isDragging, setIsDragging] = useState(false)

    const isPiP = displayMode === "pip"

    // ── Keyboard: ESC ─────────────────────────────────────────
    useEffect(() => {
        if (!session) return
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (displayMode === "expanded") minimize()
                else leaveRoom()
            }
        }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [session, displayMode, minimize, leaveRoom])

    // ── Body scroll lock (expanded mode) ──────────────────────
    useEffect(() => {
        if (displayMode === "expanded") {
            document.body.style.overflow = "hidden"
            window.scrollTo({ top: 0, behavior: "smooth" })
        }
        return () => { document.body.style.overflow = "" }
    }, [displayMode])

    // Reset drag offset when expanding (wrapped handler, not an effect)
    const expandAndReset = useCallback(() => {
        setDragOffset({ x: 0, y: 0 })
        expand()
    }, [expand])

    // ── Fullscreen toggle ─────────────────────────────────────
    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            containerRef.current?.requestFullscreen()
        }
    }, [])

    // ── Drag handlers (pointer events — touch + mouse) ────────
    // v2.13 FIX: Use containerRef for pointer capture
    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!isPiP) return
        if ((e.target as HTMLElement).closest("button")) return
        e.preventDefault()
        setIsDragging(true)
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: dragOffset.x,
            originY: dragOffset.y,
        }
        containerRef.current?.setPointerCapture(e.pointerId)
    }, [isPiP, dragOffset])

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current) return
        e.preventDefault()
        const dx = e.clientX - dragRef.current.startX
        const dy = e.clientY - dragRef.current.startY
        // v2.13: viewport boundary constraints
        const maxX = window.innerWidth - 40
        const maxY = window.innerHeight - 40
        const newX = Math.max(-maxX, Math.min(maxX, dragRef.current.originX + dx))
        const newY = Math.max(-maxY, Math.min(maxY, dragRef.current.originY + dy))
        setDragOffset({ x: newX, y: newY })
    }, [])

    const onPointerUp = useCallback(() => {
        dragRef.current = null
        setIsDragging(false)
    }, [])

    // ── Nothing to render ─────────────────────────────────────
    if (!session || !displayMode) return null

    // ─────────────────────────────────────────────────────────────
    // ARCHITECTURE: Single stable tree. The iframe is always at the
    // same position in the React tree. We render:
    //   1. Optional backdrop (expanded only — Fragment sibling, not container child)
    //   2. A container div that changes className for pip/expanded
    //   3. Header chrome (ALWAYS rendered, display:none in PiP — keeps iframe at child #2)
    //   4. The IFRAME (always child #2, never unmounted)
    //   5. Optional PiP chrome (after iframe — doesn't shift position)
    //
    // The iframe NEVER moves in the tree, so React reuses the DOM node.
    // ─────────────────────────────────────────────────────────────

    return (
        <>
            {/* ── Backdrop (expanded only) ─────────────────── */}
            {!isPiP && (
                <div
                    className="dao-room-overlay"
                    onClick={e => e.target === e.currentTarget && minimize()}
                    style={{ zIndex: 999 }}
                />
            )}

            {/* ── Container — CSS class switches layout ────── */}
            <div
                ref={containerRef}
                id="jitsi-pip"
                className={isPiP
                    ? `jitsi-pip${isDragging ? " dragging" : ""}`
                    : "dao-room-modal"
                }
                style={isPiP
                    ? {
                        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
                        touchAction: "none",
                    }
                    : {
                        position: "fixed",
                        top: "50%", left: "50%",
                        transform: "translate(-50%, -50%)",
                        zIndex: 1000,
                        width: "90vw", maxWidth: 820,
                        maxHeight: "90vh",
                    }
                }
                onPointerDown={isPiP ? onPointerDown : undefined}
                onPointerMove={isPiP ? onPointerMove : undefined}
                onPointerUp={isPiP ? onPointerUp : undefined}
            >
                {/* ── Header chrome — ALWAYS rendered to keep iframe at stable tree position ── */}
                {/* In PiP mode: hidden via display:none. React still sees it as child #1, */}
                {/* so the iframe wrapper stays at child #2 in both modes → no remount. */}
                <div
                    className="dao-room-modal-header"
                    style={isPiP ? { display: "none" } : undefined}
                >
                    <div className="dao-room-modal-title">
                        <span>{session.mode === "voice" ? "🔊" : "🎥"}</span>
                        <span>{session.label}</span>
                        <span style={{
                            fontSize: 9, padding: "2px 6px", borderRadius: 3,
                            background: "rgba(0,212,170,0.08)", color: "var(--color-primary)",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            LIVE
                        </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            id="jitsi-minimize-btn"
                            onClick={minimize}
                            title="Reduce — continue browsing while in call"
                            style={{
                                padding: "6px 12px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                                color: "var(--color-text-secondary)", cursor: "pointer",
                            }}
                        >
                            ↙ Reduce
                        </button>
                        <button
                            id="jitsi-fullscreen-btn"
                            onClick={toggleFullscreen}
                            title="Toggle fullscreen"
                            style={{
                                padding: "6px 12px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                                color: "var(--color-text-secondary)", cursor: "pointer",
                            }}
                        >
                            ⛶
                        </button>
                        <button
                            className="dao-room-modal-close"
                            onClick={leaveRoom}
                            aria-label="Leave room"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* ── IFRAME — stable position (always child #2), never unmounted ── */}
                <div className={isPiP ? "jitsi-pip-iframe-wrap" : "dao-room-modal-body"}>
                    <iframe
                        src={session.iframeSrc}
                        title={`${session.mode === "voice" ? "Voice" : "Video"} call — ${session.label}`}
                        allow="camera; microphone; display-capture; autoplay; clipboard-write"
                        referrerPolicy="no-referrer"
                        style={{
                            width: "100%",
                            height: "100%",
                            minHeight: isPiP ? undefined : 500,
                            border: "none",
                            borderRadius: isPiP ? 12 : 0,
                            pointerEvents: isDragging ? "none" : "auto",
                        }}
                    />
                </div>

                {/* ── PiP header label ────────────────────── */}
                {isPiP && (
                    <div style={{
                        position: "absolute", top: 6, left: 8,
                        display: "flex", alignItems: "center", gap: 6,
                        pointerEvents: "none",
                    }}>
                        <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: "#00d4aa", display: "inline-block",
                            animation: "pulse-dot 2s ease-in-out infinite",
                            boxShadow: "0 0 6px rgba(0,212,170,0.5)",
                        }} />
                        <span style={{
                            fontSize: 9, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace",
                            fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                        }}>
                            {session.label}
                        </span>
                    </div>
                )}

                {/* ── PiP controls ────────────────────────── */}
                {isPiP && (
                    <div className="jitsi-pip-controls">
                        <button
                            onClick={expandAndReset}
                            title="Expand"
                            style={{
                                padding: "4px 10px", borderRadius: 4, fontSize: 10,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.3)",
                                color: "var(--color-primary)", cursor: "pointer",
                            }}
                        >
                            ↗ Expand
                        </button>
                        <button
                            onClick={leaveRoom}
                            title="Leave"
                            style={{
                                padding: "4px 10px", borderRadius: 4, fontSize: 10,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(255,71,87,0.15)", border: "1px solid rgba(255,71,87,0.3)",
                                color: "var(--color-danger)", cursor: "pointer",
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>
        </>
    )
}
