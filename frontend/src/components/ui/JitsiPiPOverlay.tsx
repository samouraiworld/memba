/**
 * JitsiPiPOverlay — Persistent Jitsi iframe rendered as Layout sibling.
 *
 * Two modes:
 * - **expanded**: Full-screen modal overlay (same UX as old DAORooms modal)
 * - **pip**: Draggable mini-player (320×180, bottom-right corner)
 *
 * Critical: ONE iframe element, always mounted when session exists.
 * CSS-only switch between pip/expanded — no DOM destroy/recreate.
 *
 * @module components/ui/JitsiPiPOverlay
 */

import { useEffect, useCallback, useRef, useState } from "react"
import { useJitsiContext } from "../../contexts/JitsiContext"

export function JitsiPiPOverlay() {
    const { session, displayMode, minimize, expand, leaveRoom } = useJitsiContext()
    const containerRef = useRef<HTMLDivElement>(null)

    // ── Drag state (PiP mode) ─────────────────────────────────
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
    const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
    const [isDragging, setIsDragging] = useState(false)

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

    // ── Fullscreen toggle ─────────────────────────────────────
    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            containerRef.current?.requestFullscreen()
        }
    }, [])

    // ── Drag handlers (pointer events — touch + mouse) ────────
    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (displayMode !== "pip") return
        // Ignore if clicking a button inside PiP controls
        if ((e.target as HTMLElement).closest("button")) return
        e.preventDefault()
        setIsDragging(true)
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: dragOffset.x,
            originY: dragOffset.y,
        }
            ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
    }, [displayMode, dragOffset])

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current) return
        e.preventDefault()
        const dx = e.clientX - dragRef.current.startX
        const dy = e.clientY - dragRef.current.startY
        setDragOffset({
            x: dragRef.current.originX + dx,
            y: dragRef.current.originY + dy,
        })
    }, [])

    const onPointerUp = useCallback(() => {
        dragRef.current = null
        setIsDragging(false)
    }, [])

    // ── Nothing to render ─────────────────────────────────────
    if (!session || !displayMode) return null

    const isPiP = displayMode === "pip"

    // ── PiP mini-player ───────────────────────────────────────
    if (isPiP) {
        return (
            <div
                className={`jitsi-pip${isDragging ? " dragging" : ""}`}
                id="jitsi-pip"
                style={{
                    transform: `translate(${-dragOffset.x}px, ${-dragOffset.y}px)`,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            >
                <iframe
                    src={session.iframeSrc}
                    title={`${session.mode === "voice" ? "Voice" : "Video"} call — ${session.label}`}
                    allow="camera *; microphone *; display-capture *; autoplay; clipboard-write"
                    referrerPolicy="no-referrer"
                    style={{ width: "100%", height: "100%", border: "none", borderRadius: 12, pointerEvents: isDragging ? "none" : "auto" }}
                />
                {/* PiP header label */}
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
                        fontSize: 9, color: "#ccc", fontFamily: "JetBrains Mono, monospace",
                        fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                    }}>
                        {session.label}
                    </span>
                </div>
                {/* PiP controls */}
                <div className="jitsi-pip-controls">
                    <button
                        onClick={expand}
                        title="Expand"
                        style={{
                            padding: "4px 10px", borderRadius: 4, fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                            background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.3)",
                            color: "#00d4aa", cursor: "pointer",
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
                            color: "#ff4757", cursor: "pointer",
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>
        )
    }

    // ── Expanded modal ────────────────────────────────────────
    return (
        <div
            className="dao-room-overlay"
            onClick={e => e.target === e.currentTarget && minimize()}
        >
            <div className="dao-room-modal" ref={containerRef}>
                <div className="dao-room-modal-header">
                    <div className="dao-room-modal-title">
                        <span>{session.mode === "voice" ? "🔊" : "🎥"}</span>
                        <span>{session.label}</span>
                        <span style={{
                            fontSize: 9, padding: "2px 6px", borderRadius: 3,
                            background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                            fontFamily: "JetBrains Mono, monospace",
                        }}>
                            LIVE
                        </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            id="jitsi-minimize-btn"
                            onClick={minimize}
                            title="Minimize — continue browsing while in call"
                            style={{
                                padding: "6px 12px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                                color: "#ccc", cursor: "pointer",
                            }}
                        >
                            ↙ PiP
                        </button>
                        <button
                            id="jitsi-fullscreen-btn"
                            onClick={toggleFullscreen}
                            title="Toggle fullscreen"
                            style={{
                                padding: "6px 12px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                                color: "#ccc", cursor: "pointer",
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
                <div className="dao-room-modal-body">
                    <iframe
                        src={session.iframeSrc}
                        title={`${session.mode === "voice" ? "Voice" : "Video"} call — ${session.label}`}
                        allow="camera *; microphone *; display-capture *; autoplay; clipboard-write"
                        referrerPolicy="no-referrer"
                        style={{
                            width: "100%", height: "100%", minHeight: 500,
                            border: "none", borderRadius: 0,
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
