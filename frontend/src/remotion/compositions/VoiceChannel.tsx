/**
 * VoiceChannel — 8s animated Jitsi voice/video room join.
 *
 * Matches real DAORooms.tsx channel list and JitsiMeet.tsx integration:
 * channel sidebar → "Public Room" join → participant grid with controls.
 */
import { useCurrentFrame, spring, useVideoConfig } from "remotion"
import { MockUI, MockLabel, MockButton } from "../components/MockUI"
import { COLORS, fontMono } from "../components/tokens"

// Channels matching real DAORooms.tsx channel types
const CHANNELS = [
    { name: "general", icon: "💬" },
    { name: "announcements", icon: "📢" },
    { name: "Public Room", icon: "🔊", active: true },
    { name: "dev-call", icon: "🎥" },
]

const PARTICIPANTS = [
    { name: "g1jg8m...k9x2", label: "A" },
    { name: "g1k8p2...q4r6", label: "B" },
    { name: "g1r5t1...w3y8", label: "C" },
]

export function VoiceChannel() {
    const frame = useCurrentFrame()
    const { fps } = useVideoConfig()

    const joinFrame = 80
    const joined = frame > joinFrame

    return (
        <MockUI title="DAO Channels">
            <div style={{ display: "flex", gap: 4, flex: 1, overflow: "hidden" }}>
                {/* Channel sidebar */}
                <div style={{ width: 65, display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                    <MockLabel>Channels</MockLabel>
                    {CHANNELS.map((ch, i) => {
                        const appear = spring({ frame: frame - i * 6, fps, config: { damping: 15 } })
                        return (
                            <div
                                key={ch.name}
                                style={{
                                    opacity: appear,
                                    display: "flex", alignItems: "center", gap: 3,
                                    padding: "3px 4px", borderRadius: 4,
                                    background: ch.active ? "rgba(0,212,170,0.06)" : "transparent",
                                    border: ch.active ? "1px solid rgba(0,212,170,0.12)" : "1px solid transparent",
                                    fontSize: 6, fontFamily: fontMono,
                                    color: ch.active ? COLORS.accent : COLORS.muted,
                                    cursor: "pointer",
                                }}
                            >
                                <span style={{ fontSize: 7 }}>{ch.icon}</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {ch.name}
                                </span>
                            </div>
                        )
                    })}
                </div>

                {/* Main content area */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, borderLeft: "1px solid #222", paddingLeft: 4 }}>
                    {!joined ? (
                        /* Pre-join — channel info card */
                        <div style={{
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            flex: 1, gap: 6,
                        }}>
                            <span style={{ fontSize: 18 }}>🔊</span>
                            <div style={{ fontSize: 9, fontWeight: 600, color: COLORS.text }}>Public Room</div>
                            <div style={{ fontSize: 6, fontFamily: fontMono, color: COLORS.muted }}>
                                Voice channel · Jitsi Meet
                            </div>
                            <MockButton variant="primary">Join Room</MockButton>
                        </div>
                    ) : (
                        /* In-call UI — matches JitsiMeet layout + controls */
                        <div style={{
                            display: "flex", flexDirection: "column", gap: 4,
                            opacity: spring({ frame: frame - joinFrame, fps, config: { damping: 12 } }),
                            flex: 1,
                        }}>
                            {/* Status indicator */}
                            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                <div style={{ width: 4, height: 4, borderRadius: "50%", background: COLORS.accent, animation: "pulse 2s infinite" }} />
                                <span style={{ fontSize: 7, fontWeight: 600, color: COLORS.accent }}>In Call</span>
                                <span style={{ fontSize: 6, fontFamily: fontMono, color: COLORS.muted }}>
                                    – {PARTICIPANTS.length} participants
                                </span>
                            </div>

                            {/* Participant grid — like Jitsi tile view */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, flex: 1 }}>
                                {PARTICIPANTS.map((p, i) => {
                                    const pAppear = spring({ frame: frame - joinFrame - i * 10, fps, config: { damping: 12 } })
                                    return (
                                        <div
                                            key={p.name}
                                            style={{
                                                opacity: pAppear,
                                                background: "#0a0a0a", border: "1px solid #222",
                                                borderRadius: 4, padding: 4,
                                                display: "flex", flexDirection: "column",
                                                alignItems: "center", justifyContent: "center",
                                                gap: 2,
                                            }}
                                        >
                                            {/* Avatar circle */}
                                            <div style={{
                                                width: 18, height: 18, borderRadius: "50%",
                                                background: "rgba(0,212,170,0.1)",
                                                border: "1px solid rgba(0,212,170,0.2)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: 8, color: COLORS.accent, fontWeight: 600,
                                            }}>
                                                {p.label}
                                            </div>
                                            <span style={{ fontSize: 5, fontFamily: fontMono, color: COLORS.muted }}>
                                                {p.name}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Call controls — matches real button bar */}
                            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                                <MockButton variant="ghost">🔇 Mute</MockButton>
                                <MockButton variant="ghost">🔴 Leave</MockButton>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </MockUI>
    )
}
