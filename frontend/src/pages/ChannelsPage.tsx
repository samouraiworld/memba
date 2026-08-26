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
import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
import { getBoardInfo, detectChannelRealm } from "../plugins/board/parser"
import BoardView from "../plugins/board/BoardView"
import { GNO_RPC_URL } from "../lib/config"
import { getDAOMembers } from "../lib/dao"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { channelIcon, defaultChannel } from "./channelHelpers"
import { hasChannelUnread, markChannelVisited, updateChannelThreadCount } from "../plugins/board/boardHelpers"
import { buildCreateChannelMsg, parseOwnerAddress, isValidChannelName, type ChannelType } from "../lib/channelTemplate"
import { doContractBroadcast } from "../lib/grc20"
import { queryEval } from "../lib/dao/shared"
import type { LayoutContext } from "../types/layout"
import "./channels.css"

export function ChannelsPage() {
    const navigate = useNetworkNav()
    const { realmPath, encodedSlug, channelName: channelParam } = useDaoRoute()
    const { auth, adena } = useOutletContext<LayoutContext>()

    // State (UI only — server state lives in the queries below)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [showCreate, setShowCreate] = useState(false)
    const [ncName, setNcName] = useState("")
    const [ncDesc, setNcDesc] = useState("")
    const [ncType, setNcType] = useState<ChannelType>("text")
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState<string | null>(null)

    // G1/G2: the user's DAO membership and roles. Fails closed on error or
    // while disconnected: not a member, no roles.
    const membershipQuery = useQuery({
        queryKey: ["dao", "membership", realmPath ?? "", adena.address ?? ""],
        enabled: !!realmPath && adena.connected && !!adena.address,
        queryFn: async () => {
            try {
                const members = await getDAOMembers(GNO_RPC_URL, realmPath!)
                const member = members.find(m => m.address === adena.address)
                return member
                    ? { isMember: true, userRoles: member.tier ? [member.tier.toLowerCase(), "member"] : ["member"] }
                    : { isMember: false, userRoles: [] as string[] }
            } catch {
                return { isMember: false, userRoles: [] as string[] }
            }
        },
    })
    const isMember = membershipQuery.data?.isMember ?? false
    const userRoles = membershipQuery.data?.userRoles ?? []

    // ── Detect channel realm ──────────────────────────────────
    // undefined = still detecting, null = the DAO has no channel realm.
    const detectQuery = useQuery({
        queryKey: ["channels", "detect", realmPath ?? ""],
        enabled: !!realmPath,
        queryFn: async () => {
            try {
                return await detectChannelRealm(GNO_RPC_URL, realmPath!)
            } catch {
                return null
            }
        },
    })
    const boardPath = detectQuery.isPending ? undefined : (detectQuery.data ?? null)

    // Detect the channel realm owner (CreateChannel is owner-only on-chain).
    // Fails closed: disabled / query error / no owner → "" → create stays hidden.
    const ownerQuery = useQuery({
        queryKey: ["channels", "owner", boardPath ?? ""],
        enabled: !!boardPath && !!adena.address,
        queryFn: async () => {
            try {
                return parseOwnerAddress(await queryEval(GNO_RPC_URL, boardPath!, "GetOwner()"))
            } catch {
                return ""
            }
        },
    })
    const ownerAddress = ownerQuery.data ?? ""

    // ── Board info for the sidebar ────────────────────────────
    const infoQuery = useQuery({
        queryKey: ["channels", "board", boardPath ?? ""],
        enabled: !!boardPath,
        queryFn: async () => {
            try {
                return await getBoardInfo(GNO_RPC_URL, boardPath!)
            } catch {
                return null
            }
        },
    })
    const boardInfo = infoQuery.data ?? null
    const loading = detectQuery.isPending || (!!boardPath && infoQuery.isPending)

    // Derived, not synced: every path that changes the channel also navigates,
    // so the URL param IS the channel state; the board's default fills in when
    // there is no param. The old code mirrored the param into useState from an
    // effect, which is exactly the state-sync this page no longer does.
    const activeChannel = channelParam || (boardInfo?.channels ? defaultChannel(boardInfo.channels) : "general")

    // G3: mark the visited channel + remember its thread count (side effects
    // on localStorage only — no state writes here).
    useEffect(() => {
        if (channelParam) {
            markChannelVisited(channelParam)
            const ch = boardInfo?.channels.find(c => c.name === channelParam)
            if (ch) updateChannelThreadCount(channelParam, ch.threadCount)
        }
    }, [channelParam, boardInfo])

    const handleChannelClick = (name: string) => {
        setSidebarOpen(false)
        // G3: Mark channel as visited and store thread count
        markChannelVisited(name)
        const ch = boardInfo?.channels.find(c => c.name === name)
        if (ch) updateChannelThreadCount(name, ch.threadCount)
        navigate(`/dao/${encodedSlug}/channels/${name}`, { replace: true })
    }

    const handleChannelChange = (channel: string) => {
        navigate(`/dao/${encodedSlug}/channels/${channel}`, { replace: true })
    }

    // Owner-only: create a new channel on the realm (CreateChannel(name, desc, type)).
    const handleCreateChannel = async () => {
        const name = ncName.trim()
        // The realm's isValidChannelName forbids underscores (unlike the shared
        // client validator) — reject here too so we never waste a signed tx.
        if (!isValidChannelName(name) || name.includes("_")) {
            setCreateError("Invalid name — lowercase letters, digits and hyphens only (no underscores).")
            return
        }
        if (!boardPath || !adena.connected || !adena.address) {
            setCreateError("Connect your wallet first")
            return
        }
        setCreating(true)
        setCreateError(null)
        try {
            const msg = buildCreateChannelMsg(adena.address, boardPath, name, ncDesc.trim(), ncType)
            await doContractBroadcast([msg], `Create channel #${name}`)
            await infoQuery.refetch()
            setShowCreate(false)
            setNcName("")
            setNcDesc("")
            setNcType("text")
            handleChannelClick(name)
        } catch (err) {
            setCreateError(err instanceof Error ? err.message : "Failed to create channel")
        } finally {
            setCreating(false)
        }
    }

    const isOwner = adena.connected && !!adena.address && adena.address === ownerAddress

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
            <div className="animate-fade-in channels-page-col">
                {/* Header skeleton */}
                <div className="k-shimmer channels-shimmer-header" />
                <div className="channels-layout">
                    <div className="channels-sidebar">
                        <div className="channels-loading">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="k-shimmer channels-loading-bar" />
                            ))}
                        </div>
                    </div>
                    <div className="channels-content">
                        <div className="k-shimmer channels-shimmer-content" />
                    </div>
                </div>
            </div>
        )
    }

    // ── No channels deployed — show demo board ─────────────────
    if (boardPath === null) {
        return (
            <div className="animate-fade-in channels-page-col">
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
                <div className="channels-demo-banner">
                    <span className="channels-demo-badge">DEMO</span>
                    <span>
                        Live preview from <strong className="channels-demo-board-path">gno.land/r/gnoland/boards2/v1</strong> — deploy your own channels from the Create DAO wizard.
                    </span>
                </div>

                {/* Demo BoardView */}
                <div className="channels-layout">
                    <div className="channels-content channels-content--full">
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
        <div id="channels-page" className="animate-fade-in channels-page-col">
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
                <span className="channels-count">({activeChannelCount} channels)</span>
            </button>

            {/* ── Layout: Sidebar + Content ──────────────────── */}
            <div className="channels-layout">
                {/* Sidebar — channel list */}
                <div className={`channels-sidebar${sidebarOpen ? " open" : ""}`}>
                    <div className="channels-sidebar-header">
                        <span>Channels</span>
                        {isOwner && (
                            <button
                                className="channels-create-btn"
                                onClick={() => { setShowCreate(v => !v); setCreateError(null) }}
                                title="Create a channel (owner only)"
                                aria-label={showCreate ? "Cancel new channel" : "New channel"}
                            >
                                {showCreate ? "×" : "+ New"}
                            </button>
                        )}
                    </div>
                    {isOwner && showCreate && (
                        <div className="channels-create-form">
                            <input
                                aria-label="Channel name"
                                placeholder="channel-name"
                                value={ncName}
                                onChange={e => setNcName(e.target.value)}
                                maxLength={40}
                                disabled={creating}
                            />
                            <input
                                aria-label="Channel description"
                                placeholder="description (optional)"
                                value={ncDesc}
                                onChange={e => setNcDesc(e.target.value)}
                                maxLength={140}
                                disabled={creating}
                            />
                            <select
                                aria-label="Channel type"
                                value={ncType}
                                onChange={e => setNcType(e.target.value as ChannelType)}
                                disabled={creating}
                            >
                                <option value="text">text</option>
                                <option value="announcements">announcements</option>
                                <option value="readonly">readonly</option>
                            </select>
                            {createError && <div className="channels-create-error">{createError}</div>}
                            <button
                                className="channels-create-submit"
                                onClick={handleCreateChannel}
                                disabled={creating || !ncName.trim()}
                            >
                                {creating ? "Creating…" : "Create channel"}
                            </button>
                        </div>
                    )}
                    {channels.length === 0 ? (
                        <div className="channels-empty-sidebar">
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
                                    <span className="channel-badge channel-badge--join">Join</span>
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
