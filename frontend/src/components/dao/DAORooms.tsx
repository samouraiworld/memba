/**
 * DAORooms — Default voice/video rooms available to every DAO.
 *
 * Provides two instant-access rooms without requiring channel realm deployment:
 * - 🔊 Public Room — visible only to connected wallets (anti-squatting)
 * - 🔒 Members Room — visible only to DAO members in the UI
 *
 * Room names are deterministic via jitsiRoomName(), scoped to the DAO slug.
 * Uses the existing JitsiMeet component inside a modal overlay.
 *
 * When the full Channels feature is deployed, a "Manage channels →" link appears.
 *
 * @module components/dao/DAORooms
 */

import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { JitsiMeet } from "../ui/JitsiMeet"
import { useScrollToTop } from "../../hooks/useScrollToTop"
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

type ActiveRoom = "public" | "members" | null

export function DAORooms({ daoSlug, encodedSlug, isMember, hasChannels, isConnected }: DAORoomsProps) {
    const navigate = useNavigate()
    const [activeRoom, setActiveRoom] = useState<ActiveRoom>(null)

    // v2.10: Scroll viewport to top when modal opens (refactored to shared hook)
    useScrollToTop(!!activeRoom)

    // ESC key handler
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape" && activeRoom) {
            setActiveRoom(null)
        }
    }, [activeRoom])

    useEffect(() => {
        if (activeRoom) {
            document.addEventListener("keydown", handleKeyDown)
            document.body.style.overflow = "hidden"
        }
        return () => {
            document.removeEventListener("keydown", handleKeyDown)
            document.body.style.overflow = ""
        }
    }, [activeRoom, handleKeyDown])

    return (
        <>
            {/* Room Buttons */}
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
                            className="dao-room-btn"
                            onClick={() => setActiveRoom("public")}
                        >
                            <span className="dao-room-icon">🔊</span>
                            <div>
                                <div className="dao-room-label">Public Room</div>
                                <div className="dao-room-hint">Open to all connected wallets</div>
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
                            className="dao-room-btn dao-room-private"
                            onClick={() => setActiveRoom("members")}
                        >
                            <span className="dao-room-icon">🔒</span>
                            <div>
                                <div className="dao-room-label">Members Room</div>
                                <div className="dao-room-hint">DAO members only</div>
                            </div>
                        </button>
                    )}
                </div>
            </div>

            {/* Room Modal */}
            {activeRoom && (
                <div
                    className="dao-room-overlay"
                    onClick={e => e.target === e.currentTarget && setActiveRoom(null)}
                >
                    <div className="dao-room-modal">
                        <div className="dao-room-modal-header">
                            <div className="dao-room-modal-title">
                                <span>{activeRoom === "public" ? "🔊" : "🔒"}</span>
                                <span>{activeRoom === "public" ? "Public Room" : "Members Room"}</span>
                                <span style={{
                                    fontSize: 9, padding: "2px 6px", borderRadius: 3,
                                    background: activeRoom === "public" ? "rgba(0,212,170,0.08)" : "rgba(255,193,7,0.08)",
                                    color: activeRoom === "public" ? "#00d4aa" : "#ffc107",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    {activeRoom === "public" ? "OPEN" : "MEMBERS"}
                                </span>
                            </div>
                            <button
                                className="dao-room-modal-close"
                                onClick={() => setActiveRoom(null)}
                                aria-label="Close room"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="dao-room-modal-body">
                            <JitsiMeet
                                daoSlug={daoSlug}
                                channelName={activeRoom === "public" ? "public-room" : "members-room"}
                                mode="voice"
                                label={activeRoom === "public" ? "Public Room" : "Members Room"}
                                description={
                                    activeRoom === "public"
                                        ? "Open voice room — anyone with a connected wallet can join."
                                        : "Private voice room for DAO members."
                                }
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
