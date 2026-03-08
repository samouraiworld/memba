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

import { useState } from "react"
import { JITSI_DOMAIN, jitsiRoomName } from "./jitsiHelpers"

interface JitsiMeetProps {
    /** DAO slug or realm path — used to scope the room. */
    daoSlug: string
    /** Channel name (e.g., "voice-chat"). */
    channelName: string
    /** "voice" or "video" — controls initial config. */
    mode: "voice" | "video"
}



export function JitsiMeet({ daoSlug, channelName, mode }: JitsiMeetProps) {
    const [joined, setJoined] = useState(false)
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

    const iframeSrc = `https://${JITSI_DOMAIN}/${roomName}#${configParams}`

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
                    {mode === "voice" ? "Voice Channel" : "Video Channel"}
                </div>
                <div style={{
                    fontSize: 11,
                    color: "#666",
                    fontFamily: "JetBrains Mono, monospace",
                    maxWidth: 320,
                    textAlign: "center",
                    lineHeight: 1.6,
                }}>
                    Join a {mode === "voice" ? "voice call" : "video meeting"} with other DAO members in #{channelName}.
                    {mode === "voice" && " Camera is off by default."}
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

    return (
        <div
            id="jitsi-room"
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
                allow="camera;microphone;display-capture;autoplay;clipboard-write"
                referrerPolicy="no-referrer"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                style={{
                    width: "100%",
                    height: "100%",
                    minHeight: 500,
                    border: "none",
                    borderRadius: 12,
                }}
            />
            <button
                id="jitsi-leave-btn"
                onClick={() => setJoined(false)}
                style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid rgba(255, 71, 87, 0.3)",
                    background: "rgba(255, 71, 87, 0.15)",
                    color: "#ff4757",
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: "JetBrains Mono, monospace",
                    cursor: "pointer",
                    zIndex: 10,
                    backdropFilter: "blur(4px)",
                }}
            >
                Leave Room
            </button>
        </div>
    )
}
