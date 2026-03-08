/**
 * BoardView — Thread list, thread detail, and post forms for DAO channels.
 *
 * v2.1a: Evolved from simple board to Discord-like channels with:
 * - Channel type indicators (📢 announcements, 🔒 readonly, 💬 text)
 * - Edit/delete status display on threads and replies
 * - @mention highlighting in message bodies
 * - Archived channel detection
 * - Channel sidebar with unread indicators
 *
 * Views:
 * 1. Channel list (board/channel home)
 * 2. Thread list for a channel
 * 3. Thread detail with replies
 * 4. New thread form
 * 5. Reply form
 *
 * @module plugins/board/BoardView
 */

import { useState, useEffect, useCallback } from "react"
import type { PluginProps } from "../types"
import { getBoardInfo, getBoardThreads, getBoardThread } from "./parser"
import type { BoardInfo, BoardThread, BoardThreadDetail, BoardChannel } from "./parser"
import { buildCreateThreadMsg, buildReplyToThreadMsg } from "../../lib/boardTemplate"
import { buildChannelCreateThreadMsg, buildChannelReplyMsg } from "../../lib/channelTemplate"
import { doContractBroadcast } from "../../lib/grc20"
import { GNO_RPC_URL } from "../../lib/config"
import "./board.css"

type View = "home" | "channel" | "thread" | "new-thread"

// ── UX-L1: Lightweight inline Markdown renderer ──────────────

/** Render basic Markdown: **bold**, *italic*, `code`, [links](url), @mentions */
function renderMarkdown(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    // Split by Markdown tokens + @mentions
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|@g1[a-z0-9]{38})/g
    let lastIdx = 0
    let match: RegExpExecArray | null
    let key = 0
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index))
        const token = match[0]
        if (token.startsWith("**")) {
            parts.push(<strong key={key++} style={{ color: "#f0f0f0" }}>{token.slice(2, -2)}</strong>)
        } else if (token.startsWith("*")) {
            parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
        } else if (token.startsWith("`")) {
            parts.push(<code key={key++} style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", fontSize: 12 }}>{token.slice(1, -1)}</code>)
        } else if (token.startsWith("[")) {
            const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
            if (linkMatch) {
                parts.push(<a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#00d4aa", textDecoration: "underline" }}>{linkMatch[1]}</a>)
            }
        } else if (token.startsWith("@g1")) {
            // v2.1a: @mention highlighting
            parts.push(
                <span key={key++} style={{
                    background: "rgba(0,212,170,0.12)",
                    color: "#00d4aa",
                    padding: "1px 4px",
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {token}
                </span>
            )
        }
        lastIdx = match.index + match[0].length
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx))
    return parts
}

// ── DAO-L2: Unread thread tracking ───────────────────────────

const BOARD_VISITS_KEY = "memba_board_visits"

function getLastVisited(channel: string, threadId: number): number {
    try {
        const data = JSON.parse(localStorage.getItem(BOARD_VISITS_KEY) || "{}")
        return data[`${channel}/${threadId}`] || 0
    } catch { return 0 }
}

function markVisited(channel: string, threadId: number): void {
    try {
        const data = JSON.parse(localStorage.getItem(BOARD_VISITS_KEY) || "{}")
        data[`${channel}/${threadId}`] = Date.now()
        localStorage.setItem(BOARD_VISITS_KEY, JSON.stringify(data))
    } catch { /* quota */ }
}

interface ViewState {
    view: View
    channel: string
    threadId: number | null
}

/** Channel type → icon mapping */
function channelTypeIcon(ch: BoardChannel): string {
    if (ch.type === "announcements") return "📢"
    if (ch.type === "readonly") return "🔒"
    return "💬"
}

interface BoardViewProps extends PluginProps {
    /** Detected board/channel realm path — passed from index.tsx */
    boardPath: string
}

export default function BoardView({ boardPath, auth, adena }: BoardViewProps) {
    const isV2 = boardPath.endsWith("_channels")

    const [viewState, setViewState] = useState<ViewState>({ view: "home", channel: "general", threadId: null })
    const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null)
    const [threads, setThreads] = useState<BoardThread[]>([])
    const [threadDetail, setThreadDetail] = useState<BoardThreadDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // New thread form
    const [newTitle, setNewTitle] = useState("")
    const [newBody, setNewBody] = useState("")
    const [replyBody, setReplyBody] = useState("")
    const [posting, setPosting] = useState(false)

    const loadBoardHome = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const info = await getBoardInfo(GNO_RPC_URL, boardPath)
            setBoardInfo(info)
        } catch {
            setError("Failed to load channels")
        } finally {
            setLoading(false)
        }
    }, [boardPath])

    const loadChannel = useCallback(async (channel: string) => {
        setLoading(true)
        setError(null)
        try {
            const t = await getBoardThreads(GNO_RPC_URL, boardPath, channel)
            setThreads(t)
        } catch {
            setError("Failed to load threads")
        } finally {
            setLoading(false)
        }
    }, [boardPath])

    const loadThread = useCallback(async (channel: string, threadId: number) => {
        setLoading(true)
        setError(null)
        try {
            const t = await getBoardThread(GNO_RPC_URL, boardPath, channel, threadId)
            setThreadDetail(t)
        } catch {
            setError("Failed to load thread")
        } finally {
            setLoading(false)
        }
    }, [boardPath])

    // Load data based on view
    useEffect(() => {
        if (viewState.view === "home") loadBoardHome()
        else if (viewState.view === "channel") loadChannel(viewState.channel)
        else if (viewState.view === "thread" && viewState.threadId !== null) {
            loadThread(viewState.channel, viewState.threadId)
        }
    }, [viewState, loadBoardHome, loadChannel, loadThread])

    const navigateTo = (view: View, channel = "general", threadId: number | null = null) => {
        if (view === "thread" && threadId !== null) {
            markVisited(channel, threadId)
        }
        setViewState({ view, channel, threadId })
    }

    // ── Post Actions ────────────────────────────────────────────

    const handleCreateThread = async () => {
        if (!auth.isAuthenticated || !adena.address) return
        if (!newTitle.trim() || !newBody.trim()) { setError("Title and body are required"); return }
        setPosting(true)
        setError(null)
        try {
            // v2.1a: use channel builder for _channels realms, board builder for _board
            const msg = isV2
                ? buildChannelCreateThreadMsg(adena.address, boardPath, viewState.channel, newTitle.trim(), newBody.trim())
                : buildCreateThreadMsg(adena.address, boardPath, viewState.channel, newTitle.trim(), newBody.trim())
            await doContractBroadcast([msg], `New thread: ${newTitle.trim()}`)
            setNewTitle("")
            setNewBody("")
            navigateTo("channel", viewState.channel)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create thread")
        } finally {
            setPosting(false)
        }
    }

    const handleReply = async () => {
        if (!auth.isAuthenticated || !adena.address || viewState.threadId === null) return
        if (!replyBody.trim()) { setError("Reply body is required"); return }
        setPosting(true)
        setError(null)
        try {
            const msg = isV2
                ? buildChannelReplyMsg(adena.address, boardPath, viewState.channel, viewState.threadId, replyBody.trim())
                : buildReplyToThreadMsg(adena.address, boardPath, viewState.channel, viewState.threadId, replyBody.trim())
            await doContractBroadcast([msg], "Reply to thread")
            setReplyBody("")
            loadThread(viewState.channel, viewState.threadId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to reply")
        } finally {
            setPosting(false)
        }
    }

    // ── Styles ────────────────────────────────────────────────────

    const cardStyle: React.CSSProperties = {
        padding: "16px 20px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
        transition: "all 0.2s",
    }

    const btnStyle: React.CSSProperties = {
        padding: "8px 16px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 12,
        fontWeight: 600,
    }

    const primaryBtn: React.CSSProperties = {
        ...btnStyle,
        background: "linear-gradient(135deg, #00d4aa, #00b894)",
        color: "#000",
    }

    const ghostBtn: React.CSSProperties = {
        ...btnStyle,
        background: "none",
        color: "#00d4aa",
        border: "1px solid rgba(0,212,170,0.2)",
    }

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.3)",
        color: "#f0f0f0",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        boxSizing: "border-box",
    }

    // ── Loading / Error ────────────────────────────────────────

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
                                    <span style={{ fontSize: 14 }}>{channelTypeIcon(ch)}</span>
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

    // ── Channel View — Thread List ─────────────────────────────

    if (viewState.view === "channel") {
        // v2.1a: Check if this is a readonly/announcements channel
        const currentChannel = boardInfo?.channels.find(ch => ch.name === viewState.channel)
        const canWrite = currentChannel?.type !== "readonly" &&
            (currentChannel?.type !== "announcements" || true) // TODO: check admin role

        return (
            <div id="board-channel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button onClick={() => navigateTo("home")} style={ghostBtn} aria-label="Back to channels">
                            ←
                        </button>
                        {currentChannel && (
                            <span style={{ fontSize: 16 }}>{channelTypeIcon(currentChannel)}</span>
                        )}
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                            #{viewState.channel}
                        </h3>
                        {currentChannel?.type === "announcements" && (
                            <span style={{ fontSize: 10, color: "#f5a623", fontFamily: "JetBrains Mono, monospace" }}>
                                Admin only
                            </span>
                        )}
                        {currentChannel?.type === "readonly" && (
                            <span style={{ fontSize: 10, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                                Read only
                            </span>
                        )}
                    </div>
                    {auth.isAuthenticated && canWrite && (
                        <button
                            id="board-new-thread-btn"
                            onClick={() => navigateTo("new-thread", viewState.channel)}
                            style={primaryBtn}
                        >
                            + New Thread
                        </button>
                    )}
                </div>

                {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}

                {threads.length === 0 ? (
                    <div style={{ ...cardStyle, cursor: "default", textAlign: "center", padding: 24 }}>
                        <div style={{ fontSize: 12, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                            No threads yet. Be the first to post!
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {threads.map(t => (
                            <div
                                key={t.id}
                                id={`board-thread-${t.id}`}
                                onClick={() => navigateTo("thread", viewState.channel, t.id)}
                                onKeyDown={(e) => e.key === "Enter" && navigateTo("thread", viewState.channel, t.id)}
                                role="button"
                                tabIndex={0}
                                style={cardStyle}
                            >
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                    {/* Unread indicator */}
                                    {getLastVisited(viewState.channel, t.id) === 0 && (
                                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4aa", flexShrink: 0 }} />
                                    )}
                                    {t.title}
                                </div>
                                <div style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                                    by {t.author} · {t.replyCount} repl{t.replyCount !== 1 ? "ies" : "y"} · block {t.blockHeight}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    // ── New Thread Form ────────────────────────────────────────

    if (viewState.view === "new-thread") {
        return (
            <div id="board-new-thread" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => navigateTo("channel", viewState.channel)} style={ghostBtn} aria-label="Back to channel">
                        ←
                    </button>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                        New Thread in #{viewState.channel}
                    </h3>
                </div>

                {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}

                <input
                    id="board-thread-title"
                    type="text"
                    placeholder="Thread title..."
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    maxLength={128}
                    style={inputStyle}
                />
                <div style={{ position: "relative" }}>
                    <textarea
                        id="board-thread-body"
                        placeholder="Write your post (Markdown supported, use @g1... to mention)..."
                        value={newBody}
                        onChange={e => setNewBody(e.target.value)}
                        maxLength={8192}
                        rows={8}
                        style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
                    />
                    {/* v2.1a: Character count */}
                    <span style={{
                        position: "absolute",
                        bottom: 8,
                        right: 10,
                        fontSize: 10,
                        color: newBody.length > 7500 ? "#ff3b30" : "#444",
                        fontFamily: "JetBrains Mono, monospace",
                    }}>
                        {newBody.length}/8192
                    </span>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                    <button
                        id="board-submit-thread"
                        onClick={handleCreateThread}
                        disabled={posting || !newTitle.trim() || !newBody.trim()}
                        style={{ ...primaryBtn, opacity: posting ? 0.5 : 1 }}
                    >
                        {posting ? "Posting..." : "Create Thread"}
                    </button>
                    <button onClick={() => navigateTo("channel", viewState.channel)} style={ghostBtn}>
                        Cancel
                    </button>
                </div>
            </div>
        )
    }

    // ── Thread Detail + Replies ────────────────────────────────

    if (viewState.view === "thread" && threadDetail) {
        return (
            <div id="board-thread-detail" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => navigateTo("channel", viewState.channel)} style={ghostBtn} aria-label="Back to channel">
                        ←
                    </button>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                        {threadDetail.title}
                    </h3>
                </div>

                {/* Thread body — UX-L1: render inline Markdown + @mentions */}
                <div style={{
                    ...cardStyle,
                    cursor: "default",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    color: "#ccc",
                    fontFamily: "JetBrains Mono, monospace",
                    lineHeight: 1.6,
                }}>
                    {renderMarkdown(threadDetail.body)}
                    <div style={{ marginTop: 12, fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                        Posted by <code style={{ color: "#666" }}>{threadDetail.author}</code> at block {threadDetail.blockHeight}
                        {/* v2.1a: Edit marker */}
                        {threadDetail.edited && (
                            <span style={{
                                fontSize: 9,
                                color: "#888",
                                background: "rgba(255,255,255,0.04)",
                                padding: "1px 5px",
                                borderRadius: 3,
                            }}>
                                edited · block {threadDetail.editedAt}
                            </span>
                        )}
                    </div>
                </div>

                {/* Replies */}
                {threadDetail.replies.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <h4 style={{ fontSize: 13, color: "#888", margin: 0 }}>
                            💬 {threadDetail.replies.length} repl{threadDetail.replies.length !== 1 ? "ies" : "y"}
                        </h4>
                        {threadDetail.replies.map((r, i) => (
                            <div key={i} style={{ ...cardStyle, cursor: "default", borderLeft: "2px solid rgba(0,212,170,0.15)" }}>
                                <div style={{ fontSize: 11, color: "#666", marginBottom: 6, fontFamily: "JetBrains Mono, monospace", display: "flex", alignItems: "center", gap: 6 }}>
                                    <strong style={{ color: "#aaa" }}>{r.author}</strong> · block {r.blockHeight}
                                    {/* v2.1a: Edit marker on replies */}
                                    {r.edited && (
                                        <span style={{
                                            fontSize: 9,
                                            color: "#888",
                                            background: "rgba(255,255,255,0.04)",
                                            padding: "1px 4px",
                                            borderRadius: 3,
                                        }}>
                                            edited
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 12, color: "#ccc", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                    {renderMarkdown(r.body)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Reply form */}
                {auth.isAuthenticated && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                        {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}
                        <div style={{ position: "relative" }}>
                            <textarea
                                id="board-reply-body"
                                placeholder="Write a reply (Markdown supported, use @g1... to mention)..."
                                value={replyBody}
                                onChange={e => setReplyBody(e.target.value)}
                                maxLength={4096}
                                rows={3}
                                style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
                            />
                            <span style={{
                                position: "absolute",
                                bottom: 8,
                                right: 10,
                                fontSize: 10,
                                color: replyBody.length > 3500 ? "#ff3b30" : "#444",
                                fontFamily: "JetBrains Mono, monospace",
                            }}>
                                {replyBody.length}/4096
                            </span>
                        </div>
                        <button
                            id="board-submit-reply"
                            onClick={handleReply}
                            disabled={posting || !replyBody.trim()}
                            style={{ ...primaryBtn, opacity: posting ? 0.5 : 1, alignSelf: "flex-start" }}
                        >
                            {posting ? "Posting..." : "Reply"}
                        </button>
                    </div>
                )}
            </div>
        )
    }

    // Fallback
    return <div style={{ color: "#666", fontSize: 12 }}>Loading thread...</div>
}
