/**
 * BoardView — Orchestrator for DAO channel views.
 *
 * v2.9: Decomposed from 676 LOC monolith into 5 sub-components:
 * - BoardHeader: Channel navigation header
 * - ThreadList: Thread listing with unread indicators
 * - ThreadView: Thread detail + replies + reply form
 * - ComposeThread: New thread creation form
 * - boardHelpers: Shared utilities (renderMarkdown, visit tracking, styles)
 *
 * This file manages state, routing, and data fetching.
 *
 * @module plugins/board/BoardView
 */

import { useState, useEffect, useCallback } from "react"
import type { PluginProps } from "../types"
import { getBoardInfo } from "./parser"
import type { BoardInfo } from "./parser"
import { buildCreateThreadMsg, buildReplyToThreadMsg } from "../../lib/boardTemplate"
import { buildChannelCreateThreadMsg, buildChannelReplyMsg } from "../../lib/channelTemplate"
import { doContractBroadcast } from "../../lib/grc20"
import { GNO_RPC_URL } from "../../lib/config"
import { useChannelPolling } from "../../hooks/useChannelPolling"
import { JitsiMeet } from "../../components/ui/JitsiMeet"
import { channelIcon } from "../../pages/channelHelpers"
import { markVisited, cardStyle, primaryBtn } from "./boardHelpers"
import { BoardHeader } from "./BoardHeader"
import { ThreadList } from "./ThreadList"
import { ThreadView } from "./ThreadView"
import { ComposeThread } from "./ComposeThread"
import { GatedChannelBanner } from "./GatedChannelBanner"
import "./board.css"

type View = "home" | "channel" | "thread" | "new-thread"

interface ViewState {
    view: View
    channel: string
    threadId: number | null
}

// M3 fix: channelTypeIcon removed — use channelIcon from channelHelpers (shared)

interface BoardViewProps extends PluginProps {
    /** Detected board/channel realm path — passed from index.tsx */
    boardPath: string
    /** v2.5a: Pre-select a channel (skip home view). Used by ChannelsPage. */
    initialChannel?: string
    /** v2.5a: Callback when user navigates between channels. */
    onChannelChange?: (channel: string) => void
    /** v2.5a: Hide internal channel list — ChannelsPage provides its own sidebar. */
    hideChannelList?: boolean
    /** G1/G2: User's DAO roles for ACL checking (e.g. ["admin", "member"]). */
    userRoles?: string[]
    /** G1: DAO display name for gated channel CTA. */
    daoName?: string
    /** G2: Whether the user is a DAO member (for flag eligibility). */
    isMember?: boolean
}

export default function BoardView({ boardPath, slug, auth, adena, initialChannel, onChannelChange, hideChannelList, userRoles = [], daoName = "this DAO", isMember = false }: BoardViewProps) {
    const isV2 = boardPath.endsWith("_channels")

    // v2.5a: Start in "channel" view when initialChannel is provided (headless mode)
    const [viewState, setViewState] = useState<ViewState>(() => ({
        view: initialChannel ? "channel" : "home",
        channel: initialChannel || "general",
        threadId: null,
    }))
    const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null)

    // New thread form
    const [newTitle, setNewTitle] = useState("")
    const [newBody, setNewBody] = useState("")
    const [replyBody, setReplyBody] = useState("")
    const [posting, setPosting] = useState(false)

    // v2.5b: Real-time polling — replaces manual loadChannel/loadThread
    // P4 fix: skip polling for voice/video channels (thread data not displayed)
    const currentChannelInfo = boardInfo?.channels.find(ch => ch.name === viewState.channel)
    const isVoiceOrVideoChannel = currentChannelInfo?.type === "voice" || currentChannelInfo?.type === "video"
    const isPollingEnabled = viewState.view !== "home" && !isVoiceOrVideoChannel
    const {
        threads,
        threadDetail,
        hasNewContent,
        dismissNew,
        loading: pollingLoading,
        error: pollingError,
        refresh,
    } = useChannelPolling({
        boardPath,
        channel: viewState.channel,
        threadId: viewState.threadId,
        enabled: isPollingEnabled && !posting,
    })

    // Home view: load board info (channel list, not polled)
    const [homeLoading, setHomeLoading] = useState(viewState.view === "home")
    const [homeError, setHomeError] = useState<string | null>(null)

    // v2.5a: Sync initialChannel prop changes → switch channel view
    // v2.10: Defensive guard — if channel is not found in board info, fall back to home
    useEffect(() => {
        if (initialChannel && initialChannel !== viewState.channel) {
            // If we have board info and the channel doesn't exist, fall back
            if (boardInfo && !boardInfo.channels.some(ch => ch.name === initialChannel)) {
                setViewState({ view: "home", channel: "general", threadId: null })
                return
            }
            setViewState({ view: "channel", channel: initialChannel, threadId: null })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialChannel])

    const loadBoardHome = useCallback(async () => {
        setHomeLoading(true)
        setHomeError(null)
        try {
            const info = await getBoardInfo(GNO_RPC_URL, boardPath)
            setBoardInfo(info)
        } catch {
            setHomeError("Failed to load channels")
        } finally {
            setHomeLoading(false)
        }
    }, [boardPath])

    // Load home view when needed
    useEffect(() => {
        if (viewState.view === "home") loadBoardHome()
    }, [viewState.view, loadBoardHome])

    // Local error for form validation / post actions
    const [formError, setFormError] = useState<string | null>(null)

    // Unified loading/error — merge home and polling states
    const loading = viewState.view === "home" ? homeLoading : pollingLoading
    const error = formError || (viewState.view === "home" ? homeError : pollingError)

    const navigateTo = (view: View, channel = "general", threadId: number | null = null) => {
        setFormError(null) // I1 fix: clear form error on navigation
        if (view === "thread" && threadId !== null) {
            markVisited(channel, threadId)
        }
        // v2.5a: When navigating back to home in headless mode, go to channel instead
        if (view === "home" && hideChannelList) {
            view = "channel"
        }
        // v2.5a: Notify parent of channel change
        if (view === "channel" && onChannelChange && channel !== viewState.channel) {
            onChannelChange(channel)
        }
        setViewState({ view, channel, threadId })
    }

    // ── Post Actions ────────────────────────────────────────────

    const handleCreateThread = async () => {
        if (!auth.isAuthenticated || !adena.address) return
        if (!newTitle.trim() || !newBody.trim()) { setFormError("Title and body are required"); return }
        setPosting(true)
        setFormError(null)
        try {
            const msg = isV2
                ? buildChannelCreateThreadMsg(adena.address, boardPath, viewState.channel, newTitle.trim(), newBody.trim())
                : buildCreateThreadMsg(adena.address, boardPath, viewState.channel, newTitle.trim(), newBody.trim())
            await doContractBroadcast([msg], `New thread: ${newTitle.trim()}`)
            setNewTitle("")
            setNewBody("")
            navigateTo("channel", viewState.channel)
            refresh() // v2.5b: immediate refetch after post
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to create thread")
        } finally {
            setPosting(false)
        }
    }

    const handleReply = async () => {
        if (!auth.isAuthenticated || !adena.address || viewState.threadId === null) return
        if (!replyBody.trim()) { setFormError("Reply body is required"); return }
        setPosting(true)
        setFormError(null)
        try {
            const msg = isV2
                ? buildChannelReplyMsg(adena.address, boardPath, viewState.channel, viewState.threadId, replyBody.trim())
                : buildReplyToThreadMsg(adena.address, boardPath, viewState.channel, viewState.threadId, replyBody.trim())
            await doContractBroadcast([msg], "Reply to thread")
            setReplyBody("")
            refresh() // v2.5b: immediate refetch after reply
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to reply")
        } finally {
            setPosting(false)
        }
    }

    // ── Loading ────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 60, borderRadius: 8, background: "#111" }} />
                ))}
            </div>
        )
    }

    // ── Board Home — Channel List ──────────────────────────────

    if (viewState.view === "home") {
        if (!boardInfo) {
            return (
                <div id="board-not-found" style={{ ...cardStyle, cursor: "default", textAlign: "center", padding: 32 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
                    <div style={{ fontSize: 13, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                        No channels deployed for this DAO.
                    </div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 6, fontFamily: "JetBrains Mono, monospace" }}>
                        Channels can be deployed alongside a DAO from the Create DAO wizard.
                    </div>
                </div>
            )
        }

        return (
            <div id="board-home" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>💬</span>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                        {boardInfo.name}
                    </h3>
                </div>
                {boardInfo.description && (
                    <p style={{ fontSize: 12, color: "#888", margin: 0, fontFamily: "JetBrains Mono, monospace" }}>
                        {boardInfo.description}
                    </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {boardInfo.channels.map(ch => (
                        <div
                            key={ch.name}
                            id={`board-channel-${ch.name}`}
                            onClick={() => !ch.archived && navigateTo("channel", ch.name)}
                            onKeyDown={(e) => e.key === "Enter" && !ch.archived && navigateTo("channel", ch.name)}
                            role="button"
                            tabIndex={ch.archived ? -1 : 0}
                            style={{
                                ...cardStyle,
                                opacity: ch.archived ? 0.4 : 1,
                                cursor: ch.archived ? "default" : "pointer",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 14 }}>{channelIcon(ch)}</span>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: "#00d4aa" }}>
                                        #{ch.name}
                                    </span>
                                    {ch.archived && (
                                        <span style={{
                                            fontSize: 9,
                                            color: "#666",
                                            background: "rgba(255,255,255,0.04)",
                                            padding: "2px 6px",
                                            borderRadius: 4,
                                            textTransform: "uppercase",
                                            letterSpacing: 1,
                                        }}>
                                            archived
                                        </span>
                                    )}
                                </div>
                                <span style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                                    {ch.threadCount} thread{ch.threadCount !== 1 ? "s" : ""}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // ── Channel View ───────────────────────────────────────────

    if (viewState.view === "channel") {
        const currentChannel = boardInfo?.channels.find(ch => ch.name === viewState.channel)
        const isVoiceOrVideo = currentChannel?.type === "voice" || currentChannel?.type === "video"
        const canWrite = !isVoiceOrVideo && currentChannel?.type !== "readonly" &&
            currentChannel?.type !== "announcements" // NOTE: admin-only posting — blocked until Gno cross-realm role check

        // v2.5c: Voice/video channels — render Jitsi instead of threads
        if (isVoiceOrVideo) {
            return (
                <div id="board-channel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <BoardHeader
                        channel={viewState.channel}
                        channelInfo={currentChannel}
                        onBack={() => navigateTo("home")}
                    />
                    <JitsiMeet
                        daoSlug={slug}
                        channelName={viewState.channel}
                        mode={currentChannel.type as "voice" | "video"}
                    />
                </div>
            )
        }

        return (
            <div id="board-channel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <BoardHeader
                    channel={viewState.channel}
                    channelInfo={currentChannel}
                    onBack={() => navigateTo("home")}
                    rightAction={
                        auth.isAuthenticated && canWrite ? (
                            <button
                                id="board-new-thread-btn"
                                onClick={() => navigateTo("new-thread", viewState.channel)}
                                style={primaryBtn}
                            >
                                + New Thread
                            </button>
                        ) : undefined
                    }
                />

                {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}

                {/* G1: Gated channel banner — shown when user lacks write access */}
                <GatedChannelBanner
                    boardPath={boardPath}
                    channel={viewState.channel}
                    userRoles={userRoles}
                    isConnected={adena.connected}
                    daoName={daoName}
                />

                <ThreadList
                    threads={threads}
                    channel={viewState.channel}
                    hasNewContent={hasNewContent}
                    onDismissNew={dismissNew}
                    onSelectThread={(id) => navigateTo("thread", viewState.channel, id)}
                    error={error}
                    boardPath={boardPath}
                    isMember={isMember}
                    isAuthenticated={auth.isAuthenticated}
                    callerAddress={adena.address}
                    onFlagged={refresh}
                />
            </div>
        )
    }

    // ── New Thread Form ────────────────────────────────────────

    if (viewState.view === "new-thread") {
        return (
            <ComposeThread
                channel={viewState.channel}
                title={newTitle}
                body={newBody}
                onTitleChange={setNewTitle}
                onBodyChange={setNewBody}
                onSubmit={handleCreateThread}
                onCancel={() => navigateTo("channel", viewState.channel)}
                posting={posting}
                error={error}
            />
        )
    }

    // ── Thread Detail + Replies ────────────────────────────────

    if (viewState.view === "thread" && threadDetail) {
        return (
            <div id="board-thread-detail" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <BoardHeader
                    channel={viewState.channel}
                    onBack={() => navigateTo("channel", viewState.channel)}
                    rightAction={
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                            {threadDetail.title}
                        </h3>
                    }
                />

                <ThreadView
                    threadDetail={threadDetail}
                    hasNewContent={hasNewContent}
                    onDismissNew={dismissNew}
                    isAuthenticated={auth.isAuthenticated}
                    replyBody={replyBody}
                    onReplyChange={setReplyBody}
                    onSubmitReply={handleReply}
                    posting={posting}
                    error={error}
                />
            </div>
        )
    }

    // Fallback
    return <div style={{ color: "#666", fontSize: 12 }}>Loading thread...</div>
}
