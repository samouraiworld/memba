/**
 * JitsiMeet — Embedded Jitsi Meet room for voice/video channels (v2.5c).
 *
 * Renders a "Join Room" button that, when clicked, displays a Jitsi iframe.
 * Room names are deterministic: derived from the DAO slug + channel name.
 *
 * Uses meet.jit.si public instance (free, no API key).
 * Future: self-hosted Jitsi for sovereignty (v4.0).
 *
 * @module components/ui/JitsiMeet
 */

import { useState, useRef, useCallback } from "react"
import { jitsiRoomName, jitsiIframeSrc } from "./jitsiHelpers"

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
    const [joined, setJoined] = useState(false)
    const [minimized, setMinimized] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const roomName = jitsiRoomName(daoSlug, channelName)

    // Jitsi iframe config
    const configParams = [
        "config.startWithAudioMuted=false",
        `config.startWithVideoMuted=${mode === "voice" ? "true" : "false"}`,
        "config.prejoinPageEnabled=false",
        "config.disableDeepLinking=true",
        "config.disableProfile=true",
        "config.hideConferenceSubject=true",
        "interfaceConfig.SHOW_JITSI_WATERMARK=false",
        "interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false",
        "interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true",
    ].join("&")

    const iframeSrc = jitsiIframeSrc(roomName, configParams)

    // Must be declared before conditional returns (React hooks rules)
    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            containerRef.current?.requestFullscreen()
        }
    }, [])

    if (!joined) {
        return (
            <div
                id="jitsi-join"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    minHeight: 400,
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.04)",
                    background: "rgba(0, 0, 0, 0.15)",
                }}
            >
                <span style={{ fontSize: 48 }}>{mode === "voice" ? "🔊" : "🎥"}</span>
                <div style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#f0f0f0",
                }}>
                    {label || (mode === "voice" ? "Voice Channel" : "Video Channel")}
                </div>
                <div style={{
                    fontSize: 11,
                    color: "#666",
                    fontFamily: "JetBrains Mono, monospace",
                    maxWidth: 320,
                    textAlign: "center",
                    lineHeight: 1.6,
                }}>
                    {description || `Join a ${mode === "voice" ? "voice call" : "video meeting"} with other DAO members in #${channelName}.`}
                    {!description && mode === "voice" && " Camera is off by default."}
                </div>
                <button
                    id="jitsi-join-btn"
                    onClick={() => setJoined(true)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 24px",
                        borderRadius: 8,
                        border: "1px solid rgba(0, 212, 170, 0.3)",
                        background: "rgba(0, 212, 170, 0.1)",
                        color: "#00d4aa",
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: "JetBrains Mono, monospace",
                        cursor: "pointer",
                        transition: "all 0.15s",
                    }}
                >
                    <span>{mode === "voice" ? "🎙️" : "📹"}</span>
                    <span>Join Room</span>
                </button>
                <div style={{
                    fontSize: 9,
                    color: "#444",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    Powered by Jitsi Meet • No account required
                </div>
            </div>
        )
    }


    // ── Minimized PiP mode ──────────────────────────────────
    if (joined && minimized) {
        return (
            <div
                className="jitsi-pip"
                id="jitsi-pip"
            >
                <iframe
                    src={iframeSrc}
                    title={`${mode === "voice" ? "Voice" : "Video"} call — #${channelName}`}
                    allow="camera *; microphone *; display-capture *; autoplay; clipboard-write"
                    referrerPolicy="no-referrer"
                    style={{ width: "100%", height: "100%", border: "none", borderRadius: 12 }}
                />
                <div className="jitsi-pip-controls">
                    <button
                        onClick={() => setMinimized(false)}
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
                        onClick={() => { setJoined(false); setMinimized(false) }}
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

    return (
        <div
            id="jitsi-room"
            ref={containerRef}
            style={{
                position: "relative",
                width: "100%",
                minHeight: 500,
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(255, 255, 255, 0.04)",
                background: "#000",
            }}
        >
            <iframe
                src={iframeSrc}
                title={`${mode === "voice" ? "Voice" : "Video"} call — #${channelName}`}
                allow="camera *; microphone *; display-capture *; autoplay; clipboard-write"
                referrerPolicy="no-referrer"
                style={{
                    width: "100%",
                    height: "100%",
                    minHeight: 500,
                    border: "none",
                    borderRadius: 12,
                }}
            />
            {/* Floating toolbar: Minimize | Fullscreen | Leave */}
            <div style={{
                position: "absolute", top: 12, right: 12,
                display: "flex", gap: 6, zIndex: 10,
            }}>
                <button
                    id="jitsi-minimize-btn"
                    onClick={() => setMinimized(true)}
                    title="Minimize — continue browsing while in call"
                    style={{
                        padding: "6px 12px", borderRadius: 6, fontSize: 11,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc", cursor: "pointer", backdropFilter: "blur(4px)",
                    }}
                >
                    ↙ Minimize
                </button>
                <button
                    id="jitsi-fullscreen-btn"
                    onClick={toggleFullscreen}
                    title="Toggle fullscreen"
                    style={{
                        padding: "6px 12px", borderRadius: 6, fontSize: 11,
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc", cursor: "pointer", backdropFilter: "blur(4px)",
                    }}
                >
                    ⛶ Fullscreen
                </button>
                <button
                    id="jitsi-leave-btn"
                    onClick={() => setJoined(false)}
                    style={{
                        padding: "6px 14px", borderRadius: 6,
                        border: "1px solid rgba(255, 71, 87, 0.3)",
                        background: "rgba(255, 71, 87, 0.15)",
                        color: "#ff4757", fontSize: 11, fontWeight: 600,
                        fontFamily: "JetBrains Mono, monospace",
                        cursor: "pointer", backdropFilter: "blur(4px)",
                    }}
                >
                    Leave Room
                </button>
            </div>
        </div>
    )
}
