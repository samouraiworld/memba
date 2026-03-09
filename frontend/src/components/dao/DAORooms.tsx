/**
 * DAORooms — Default voice/video rooms available to every DAO.
 *
 * Provides two instant-access rooms without requiring channel realm deployment:
 * - 🔊 Public Room — visible only to connected wallets (anti-squatting)
 * - 🔒 Members Room — visible only to DAO members in the UI
 *
 * v2.11: Room join now delegates to JitsiContext (portal-based PiP).
 * The modal overlay is handled by JitsiPiPOverlay in Layout.
 *
 * @module components/dao/DAORooms
 */

import { useNavigate } from "react-router-dom"
import { useJitsiContext } from "../../contexts/JitsiContext"
import "./dao-rooms.css"

interface DAORoomsProps {
    /** DAO slug for room scoping + navigation. */
    daoSlug: string
    /** Encoded slug for route navigation. */
    encodedSlug: string
    /** Whether the current user is a DAO member. */
    isMember: boolean
    /** Whether this DAO has deployed the full Channels feature. */
    hasChannels: boolean
    /** Whether the user has a connected wallet (Adena). */
    isConnected: boolean
}

export function DAORooms({ daoSlug, encodedSlug, isMember, hasChannels, isConnected }: DAORoomsProps) {
    const navigate = useNavigate()
    const { session, joinRoom } = useJitsiContext()

    // Check if user is already in a room for this DAO
    const isInPublicRoom = session?.daoSlug === daoSlug && session?.channelName === "public-room"
    const isInMembersRoom = session?.daoSlug === daoSlug && session?.channelName === "members-room"

    return (
        <div className="k-card" data-testid="dao-rooms" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🎙️</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#f0f0f0" }}>Rooms</span>
                </div>
                {hasChannels && (
                    <button
                        onClick={() => navigate(`/dao/${encodedSlug}/channels`)}
                        style={{
                            color: "#555", fontSize: 10, background: "none", border: "none",
                            cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                            transition: "color 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"}
                        onMouseLeave={e => e.currentTarget.style.color = "#555"}
                    >
                        Manage channels →
                    </button>
                )}
            </div>

            <div className="dao-rooms">
                {/* Public Room — visible only when wallet is connected */}
                {isConnected ? (
                    <button
                        id="dao-room-public"
                        className={`dao-room-btn${isInPublicRoom ? " dao-room-active" : ""}`}
                        onClick={() => joinRoom({
                            daoSlug,
                            channelName: "public-room",
                            mode: "voice",
                            label: "Public Room",
                            description: "Open voice room — anyone with a connected wallet can join.",
                        })}
                    >
                        <span className="dao-room-icon">🔊</span>
                        <div>
                            <div className="dao-room-label">
                                Public Room
                                {isInPublicRoom && (
                                    <span style={{
                                        marginLeft: 6, width: 6, height: 6, borderRadius: "50%",
                                        background: "#00d4aa", display: "inline-block",
                                        animation: "pulse-dot 2s ease-in-out infinite",
                                    }} />
                                )}
                            </div>
                            <div className="dao-room-hint">
                                {isInPublicRoom ? "In call — click to expand" : "Open to all connected wallets"}
                            </div>
                        </div>
                    </button>
                ) : (
                    <div className="dao-room-btn dao-room-disabled">
                        <span className="dao-room-icon" style={{ opacity: 0.4 }}>🔊</span>
                        <div>
                            <div className="dao-room-label" style={{ opacity: 0.4 }}>Public Room</div>
                            <div className="dao-room-hint">Connect wallet to join rooms</div>
                        </div>
                    </div>
                )}

                {/* Members Room — visible only to members */}
                {isMember && (
                    <button
                        id="dao-room-members"
                        className={`dao-room-btn dao-room-private${isInMembersRoom ? " dao-room-active" : ""}`}
                        onClick={() => joinRoom({
                            daoSlug,
                            channelName: "members-room",
                            mode: "voice",
                            label: "Members Room",
                            description: "Private voice room for DAO members.",
                        })}
                    >
                        <span className="dao-room-icon">🔒</span>
                        <div>
                            <div className="dao-room-label">
                                Members Room
                                {isInMembersRoom && (
                                    <span style={{
                                        marginLeft: 6, width: 6, height: 6, borderRadius: "50%",
                                        background: "#00d4aa", display: "inline-block",
                                        animation: "pulse-dot 2s ease-in-out infinite",
                                    }} />
                                )}
                            </div>
                            <div className="dao-room-hint">
                                {isInMembersRoom ? "In call — click to expand" : "DAO members only"}
                            </div>
                        </div>
                    </button>
                )}
            </div>
        </div>
    )
}
