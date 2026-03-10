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
 * @deprecated Since v2.12, room buttons are rendered directly in DAOHome
 * sidebar. This component is retained for potential Channel page re-use
 * but should not be re-enabled without reviewing slug canonicalization
 * (all operations must use `encodedSlug`, not decoded `daoSlug`).
 *
 * @module components/dao/DAORooms
 */

import { useNavigate } from "react-router-dom"
import { memo } from "react"
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const DAORooms = memo(function DAORooms({ daoSlug, encodedSlug, isMember, hasChannels, isConnected }: DAORoomsProps) {
    const navigate = useNavigate()
    const { session, joinRoom } = useJitsiContext()

    // Check if user is already in a room for this DAO
    const isInPublicRoom = session?.daoSlug === encodedSlug && session?.channelName === "public-room"
    const isInMembersRoom = session?.daoSlug === encodedSlug && session?.channelName === "members-room"

    return (
        <div className="k-card" data-testid="dao-rooms" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🎙️</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#f0f0f0" }}>Live Rooms</span>
                    {(isInPublicRoom || isInMembersRoom) && (
                        <span aria-live="polite" style={{
                            fontSize: 9, padding: "2px 6px", borderRadius: 3,
                            background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                            fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        }}>
                            IN CALL
                        </span>
                    )}
                </div>
                {hasChannels && (
                    <button
                        aria-label="Manage channels"
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
                        aria-label={isInPublicRoom ? "Expand Public Room call" : "Join Public Room"}
                        className={`dao-room-btn${isInPublicRoom ? " dao-room-active" : ""}`}
                        onClick={() => joinRoom({
                            daoSlug: encodedSlug,
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
                        aria-label={isInMembersRoom ? "Expand Members Room call" : "Join Members Room"}
                        className={`dao-room-btn dao-room-private${isInMembersRoom ? " dao-room-active" : ""}`}
                        onClick={() => joinRoom({
                            daoSlug: encodedSlug,
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
})
