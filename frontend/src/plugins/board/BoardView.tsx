/**
 * BoardView — Thread list, thread detail, and post forms for DAO boards.
 *
 * Views:
 * 1. Channel list (board home)
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
import type { BoardInfo, BoardThread, BoardThreadDetail } from "./parser"
import { buildCreateThreadMsg, buildReplyToThreadMsg } from "../../lib/boardTemplate"
import { doContractBroadcast } from "../../lib/grc20"
import { GNO_RPC_URL } from "../../lib/config"

type View = "home" | "channel" | "thread" | "new-thread"

interface ViewState {
    view: View
    channel: string
    threadId: number | null
}

export default function BoardView({ realmPath, auth, adena }: PluginProps) {
    const boardPath = `${realmPath}_board`

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
            setError("Failed to load board")
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
        setViewState({ view, channel, threadId })
    }

    // ── Post Actions ────────────────────────────────────────────

    const handleCreateThread = async () => {
        if (!auth.isAuthenticated || !adena.address) return
        if (!newTitle.trim() || !newBody.trim()) { setError("Title and body are required"); return }
        setPosting(true)
        setError(null)
        try {
            const msg = buildCreateThreadMsg(adena.address, boardPath, viewState.channel, newTitle.trim(), newBody.trim())
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
            const msg = buildReplyToThreadMsg(adena.address, boardPath, viewState.channel, viewState.threadId, replyBody.trim())
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
                    <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
                    <div style={{ fontSize: 13, color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
                        No board deployed for this DAO.
                    </div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 6, fontFamily: "JetBrains Mono, monospace" }}>
                        Board can be deployed alongside a DAO from the Create DAO wizard.
                    </div>
                </div>
            )
        }

        return (
            <div id="board-home" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>📋</span>
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
                            onClick={() => navigateTo("channel", ch.name)}
                            onKeyDown={(e) => e.key === "Enter" && navigateTo("channel", ch.name)}
                            role="button"
                            tabIndex={0}
                            style={cardStyle}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: "#00d4aa" }}>
                                    #{ch.name}
                                </span>
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
        return (
            <div id="board-channel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button onClick={() => navigateTo("home")} style={ghostBtn} aria-label="Back to channels">
                            ←
                        </button>
                        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                            #{viewState.channel}
                        </h3>
                    </div>
                    {auth.isAuthenticated && (
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
                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 4 }}>
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
                <textarea
                    id="board-thread-body"
                    placeholder="Write your post (Markdown supported)..."
                    value={newBody}
                    onChange={e => setNewBody(e.target.value)}
                    maxLength={8192}
                    rows={8}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
                />
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

                {/* Thread body */}
                <div style={{
                    ...cardStyle,
                    cursor: "default",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    color: "#ccc",
                    fontFamily: "JetBrains Mono, monospace",
                    lineHeight: 1.6,
                }}>
                    {threadDetail.body}
                    <div style={{ marginTop: 12, fontSize: 11, color: "#555" }}>
                        Posted by <code style={{ color: "#666" }}>{threadDetail.author}</code> at block {threadDetail.blockHeight}
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
                                <div style={{ fontSize: 11, color: "#666", marginBottom: 6, fontFamily: "JetBrains Mono, monospace" }}>
                                    <strong style={{ color: "#aaa" }}>{r.author}</strong> · block {r.blockHeight}
                                </div>
                                <div style={{ fontSize: 12, color: "#ccc", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                    {r.body}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Reply form */}
                {auth.isAuthenticated && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                        {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}
                        <textarea
                            id="board-reply-body"
                            placeholder="Write a reply..."
                            value={replyBody}
                            onChange={e => setReplyBody(e.target.value)}
                            maxLength={4096}
                            rows={3}
                            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
                        />
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
