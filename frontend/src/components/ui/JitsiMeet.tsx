/**
 * JitsiMeet — Join gate for Jitsi Meet rooms (v2.11).
 *
 * Renders a "Join Room" button. When clicked, delegates to JitsiContext
 * which handles the iframe rendering in JitsiPiPOverlay (Layout sibling).
 *
 * If user is already in the room, shows "In Call" status with PiP controls.
 *
 * The iframe rendering, PiP, minimize/expand, drag, and fullscreen logic
 * are all handled by JitsiPiPOverlay — not this component.
 *
 * @module components/ui/JitsiMeet
 */

import { useJitsiContext } from "../../contexts/JitsiContext"
import { jitsiRoomName } from "./jitsiHelpers"

interface JitsiMeetProps {
    /** DAO slug or realm path — used to scope the room. */
    daoSlug: string
    /** Channel name (e.g., "voice-chat"). */
    channelName: string
    /** "voice" or "video" — controls initial config. */
    mode: "voice" | "video"
    /** Optional display label (defaults to "Voice Channel" / "Video Channel"). */
    label?: string
    /** Optional description text for the join gate. */
    description?: string
}

export function JitsiMeet({ daoSlug, channelName, mode, label, description }: JitsiMeetProps) {
    const { session, joinRoom, expand, leaveRoom } = useJitsiContext()
    const roomName = jitsiRoomName(daoSlug, channelName)
    const isInThisRoom = session?.roomName === roomName

    // ── Already in this room ──────────────────────────────────
    if (isInThisRoom) {
        return (
            <div
                id="jitsi-in-call"
                style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 16, minHeight: 400,
                    borderRadius: 12, border: "1px solid rgba(0, 212, 170, 0.15)",
                    background: "rgba(0, 212, 170, 0.02)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: "#00d4aa", display: "inline-block",
                        animation: "pulse-dot 2s ease-in-out infinite",
                        boxShadow: "0 0 8px rgba(0,212,170,0.5)",
                    }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-primary)" }}>
                        In Call
                    </span>
                </div>
                <div style={{
                    fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace",
                    textAlign: "center", lineHeight: 1.6, maxWidth: 320,
                }}>
                    You're connected to {label || channelName}. Use the PiP mini-player to browse while staying in the call.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        onClick={expand}
                        style={{
                            padding: "8px 16px", borderRadius: 8,
                            border: "1px solid rgba(0,212,170,0.3)",
                            background: "rgba(0,212,170,0.1)",
                            color: "var(--color-primary)", fontSize: 12, fontWeight: 600,
                            fontFamily: "JetBrains Mono, monospace",
                            cursor: "pointer", transition: "all 0.15s",
                        }}
                    >
                        ↗ Expand Room
                    </button>
                    <button
                        onClick={leaveRoom}
                        style={{
                            padding: "8px 16px", borderRadius: 8,
                            border: "1px solid rgba(255,71,87,0.3)",
                            background: "rgba(255,71,87,0.08)",
                            color: "var(--color-danger)", fontSize: 12, fontWeight: 600,
                            fontFamily: "JetBrains Mono, monospace",
                            cursor: "pointer", transition: "all 0.15s",
                        }}
                    >
                        Leave Room
                    </button>
                </div>
            </div>
        )
    }

    // ── Join gate ──────────────────────────────────────────────
    return (
        <div
            id="jitsi-join"
            style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 16, minHeight: 400,
                borderRadius: 12, border: "1px solid rgba(255, 255, 255, 0.04)",
                background: "rgba(0, 0, 0, 0.15)",
            }}
        >
            <span style={{ fontSize: 48 }}>{mode === "voice" ? "🔊" : "🎥"}</span>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>
                {label || (mode === "voice" ? "Voice Channel" : "Video Channel")}
            </div>
            <div style={{
                fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace",
                maxWidth: 320, textAlign: "center", lineHeight: 1.6,
            }}>
                {description || `Join a ${mode === "voice" ? "voice call" : "video meeting"} with other DAO members in #${channelName}.`}
                {!description && mode === "voice" && " Camera is off by default."}
            </div>
            <button
                id="jitsi-join-btn"
                onClick={() => joinRoom({ daoSlug, channelName, mode, label: label || (mode === "voice" ? "Voice Channel" : "Video Channel"), description })}
                style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 24px", borderRadius: 8,
                    border: "1px solid rgba(0, 212, 170, 0.3)",
                    background: "rgba(0, 212, 170, 0.1)",
                    color: "var(--color-primary)", fontSize: 13, fontWeight: 600,
                    fontFamily: "JetBrains Mono, monospace",
                    cursor: "pointer", transition: "all 0.15s",
                }}
            >
                <span>{mode === "voice" ? "🎙️" : "📹"}</span>
                <span>Join Room</span>
            </button>
            <div style={{ fontSize: 9, color: "var(--color-text-dim)", fontFamily: "JetBrains Mono, monospace" }}>
                Powered by Jitsi Meet • No account required
            </div>
        </div>
    )
}
