/**
 * ChannelsPage — Full-page channel experience for DAOs (v2.5a).
 *
 * Layout: DAO header + sidebar (channel list) + content area (BoardView headless).
 * Route: /dao/:slug/channels or /dao/:slug/channels/:channel
 *
 * Reuses existing BoardView, parser, and channelTemplate infrastructure.
 * Mobile: sidebar collapses behind a toggle below 768px.
 *
 * @module pages/ChannelsPage
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { getBoardInfo, detectChannelRealm } from "../plugins/board/parser"
import type { BoardInfo } from "../plugins/board/parser"
import BoardView from "../plugins/board/BoardView"
import { GNO_RPC_URL } from "../lib/config"
import { getDAOMembers } from "../lib/dao"
import { decodeSlug, encodeSlug } from "../lib/daoSlug"
import { channelIcon, defaultChannel } from "./channelHelpers"
import { hasChannelUnread, markChannelVisited, updateChannelThreadCount } from "../plugins/board/boardHelpers"
import type { LayoutContext } from "../types/layout"
import "./channels.css"

export function ChannelsPage() {
    const navigate = useNetworkNav()
    const { slug, channel: channelParam } = useParams<{ slug: string; channel?: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""
    const encodedSlug = slug || encodeSlug(realmPath)

    // State
    const [boardPath, setBoardPath] = useState<string | null | undefined>(undefined)
    const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null)
    const [activeChannel, setActiveChannel] = useState<string>(channelParam || "general")
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [loading, setLoading] = useState(true)
    // G1/G2: Membership for ACL checks and moderation
    const [userRoles, setUserRoles] = useState<string[]>([])
    const [isMember, setIsMember] = useState(false)

    // G1/G2: Detect user's DAO membership and roles
    useEffect(() => {
        if (!realmPath || !adena.connected || !adena.address) {
            setUserRoles([])
            setIsMember(false)
            return
        }
        getDAOMembers(GNO_RPC_URL, realmPath)
            .then(members => {
                const member = members.find(m => m.address === adena.address)
                if (member) {
                    setIsMember(true)
                    setUserRoles(member.tier ? [member.tier.toLowerCase(), "member"] : ["member"])
                } else {
                    setIsMember(false)
                    setUserRoles([])
                }
            })
            .catch(() => {
                setIsMember(false)
                setUserRoles([])
            })
    }, [realmPath, adena.connected, adena.address])

    // ── Detect channel realm ──────────────────────────────────
    useEffect(() => {
        if (!realmPath) return
        setLoading(true)
        detectChannelRealm(GNO_RPC_URL, realmPath)
            .then(setBoardPath)
            .catch(() => setBoardPath(null))
    }, [realmPath])

    // ── Load board info for sidebar ───────────────────────────
    const loadBoardInfo = useCallback(async () => {
        if (!boardPath) return
        try {
            const info = await getBoardInfo(GNO_RPC_URL, boardPath)
            setBoardInfo(info)
            // If no channel param, default to first active channel
            if (!channelParam && info?.channels) {
                setActiveChannel(defaultChannel(info.channels))
            }
        } catch {
            setBoardInfo(null)
        } finally {
            setLoading(false)
        }
    }, [boardPath, channelParam])

    useEffect(() => {
        if (boardPath) loadBoardInfo()
        else if (boardPath === null) setLoading(false)
    }, [boardPath, loadBoardInfo])

    // Sync URL channel param → state + G3: mark as visited
    useEffect(() => {
        if (channelParam) {
            setActiveChannel(channelParam)
            markChannelVisited(channelParam)
            const ch = boardInfo?.channels.find(c => c.name === channelParam)
            if (ch) updateChannelThreadCount(channelParam, ch.threadCount)
        }
    }, [channelParam, boardInfo])

    const handleChannelClick = (name: string) => {
        setActiveChannel(name)
        setSidebarOpen(false)
        // G3: Mark channel as visited and store thread count
        markChannelVisited(name)
        const ch = boardInfo?.channels.find(c => c.name === name)
        if (ch) updateChannelThreadCount(name, ch.threadCount)
        navigate(`/dao/${encodedSlug}/channels/${name}`, { replace: true })
    }

    const handleChannelChange = (channel: string) => {
        setActiveChannel(channel)
        navigate(`/dao/${encodedSlug}/channels/${channel}`, { replace: true })
    }

    // ── No realm path ─────────────────────────────────────────
    if (!realmPath) {
        return (
            <div className="animate-fade-in channels-empty">
                <span className="icon">💬</span>
                <div className="title">No DAO Selected</div>
                <div className="desc">Navigate to a DAO to view its channels.</div>
            </div>
        )
    }

    // ── Loading ───────────────────────────────────────────────
    if (loading || boardPath === undefined) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Header skeleton */}
                <div className="k-shimmer" style={{ height: 32, borderRadius: 8, background: "#111", maxWidth: 300 }} />
                <div className="channels-layout">
                    <div className="channels-sidebar">
                        <div className="channels-loading">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="k-shimmer channels-loading-bar" />
                            ))}
                        </div>
                    </div>
                    <div className="channels-content">
                        <div className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "#111" }} />
                    </div>
                </div>
            </div>
        )
    }

    // ── No channels deployed — show demo board ─────────────────
    if (boardPath === null) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="channels-header">
                    <div className="breadcrumb">
                        <button onClick={() => navigate("/dao")}>DAOs</button>
                        <span className="sep">›</span>
                        <button onClick={() => navigate(`/dao/${encodedSlug}`)}>
                            {realmPath.split("/").pop() || "DAO"}
                        </button>
                        <span className="sep">›</span>
                        <span className="current">Channels</span>
                    </div>
                </div>

                {/* Demo banner */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 16px", borderRadius: 8,
                    background: "rgba(0, 212, 170, 0.04)",
                    border: "1px solid rgba(0, 212, 170, 0.12)",
                    fontSize: 11, color: "#888",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    <span style={{
                        fontSize: 9, padding: "2px 6px", borderRadius: 3,
                        background: "rgba(0, 212, 170, 0.1)", color: "#00d4aa",
                        fontWeight: 700, letterSpacing: "0.05em",
                    }}>DEMO</span>
                    <span>
                        Live preview from <strong style={{ color: "#aaa" }}>gno.land/r/gnoland/boards2/v1</strong> — deploy your own channels from the Create DAO wizard.
                    </span>
                </div>

                {/* Demo BoardView */}
                <div className="channels-layout">
                    <div className="channels-content" style={{ flex: 1 }}>
                        <BoardView
                            boardPath="gno.land/r/gnoland/boards2/v1"
                            realmPath={realmPath}
                            slug={encodedSlug}
                            auth={auth}
                            adena={adena}
                            hideChannelList={false}
                        />
                    </div>
                </div>
            </div>
        )
    }

    // ── Main Layout ───────────────────────────────────────────
    const channels = boardInfo?.channels || []
    // C4 fix: compute once instead of inline filter every render
    const activeChannelCount = channels.filter(c => !c.archived).length

    return (
        <div id="channels-page" className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* ── Header ────────────────────────────────────── */}
            <div className="channels-header">
                <div className="breadcrumb">
                    <button onClick={() => navigate("/dao")}>DAOs</button>
                    <span className="sep">›</span>
                    <button onClick={() => navigate(`/dao/${encodedSlug}`)}>
                        {boardInfo?.name?.replace(" Channels", "").replace(" Board", "") || realmPath.split("/").pop() || "DAO"}
                    </button>
                    <span className="sep">›</span>
                    <span className="current">Channels</span>
                </div>
            </div>

            {/* ── Mobile Toggle ─────────────────────────────── */}
            <button
                className="channels-mobile-toggle"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? "Hide channels" : "Show channels"}
            >
                <span>{sidebarOpen ? "▼" : "▶"}</span>
                <span>#{activeChannel}</span>
                <span style={{ color: "#444" }}>({activeChannelCount} channels)</span>
            </button>

            {/* ── Layout: Sidebar + Content ──────────────────── */}
            <div className="channels-layout">
                {/* Sidebar — channel list */}
                <div className={`channels-sidebar${sidebarOpen ? " open" : ""}`}>
                    <div className="channels-sidebar-header">
                        Channels
                    </div>
                    {channels.length === 0 ? (
                        <div style={{ padding: "8px 14px", fontSize: 11, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                            No channels found
                        </div>
                    ) : (
                        channels.map(ch => (
                            <button
                                key={ch.name}
                                id={`channel-nav-${ch.name}`}
                                className={`channels-sidebar-item${ch.name === activeChannel ? " active" : ""}${ch.archived ? " archived" : ""}`}
                                onClick={() => !ch.archived && handleChannelClick(ch.name)}
                                disabled={ch.archived}
                                title={ch.archived ? `#${ch.name} (archived)` : `#${ch.name}`}
                            >
                                <span className="channel-icon">{channelIcon(ch)}</span>
                                <span className="channel-name">{ch.name}</span>
                                {ch.type === "readonly" && <span className="channel-lock-icon">🔒</span>}
                                {ch.type === "announcements" && <span className="channel-lock-icon">📢</span>}
                                {ch.archived && <span className="channel-badge">archived</span>}
                                {/* U1 fix: show "Join" for voice/video, thread count for text */}
                                {!ch.archived && (ch.type === "voice" || ch.type === "video") && (
                                    <span className="channel-badge" style={{ color: "#00d4aa", background: "rgba(0, 212, 170, 0.08)" }}>Join</span>
                                )}
                                {/* G3: Unread dot */}
                                {!ch.archived && ch.type !== "voice" && ch.type !== "video" && ch.name !== activeChannel && hasChannelUnread(ch.name, ch.threadCount) && (
                                    <span className="channel-unread-dot" />
                                )}
                                {!ch.archived && ch.type !== "voice" && ch.type !== "video" && ch.threadCount > 0 && (
                                    <span className="thread-count">{ch.threadCount}</span>
                                )}
                            </button>
                        ))
                    )}
                </div>

                {/* Content — BoardView in headless mode */}
                <div className="channels-content">
                    <BoardView
                        boardPath={boardPath}
                        realmPath={realmPath}
                        slug={encodedSlug}
                        auth={auth}
                        adena={adena}
                        initialChannel={activeChannel}
                        onChannelChange={handleChannelChange}
                        hideChannelList
                        userRoles={userRoles}
                        daoName={boardInfo?.name?.replace(" Channels", "").replace(" Board", "") || "this DAO"}
                        isMember={isMember}
                    />
                </div>
            </div>
        </div>
    )
}
