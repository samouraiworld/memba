/**
 * ThreadView — Thread detail with replies and reply form.
 *
 * Extracted from BoardView.tsx (v2.9 decomposition).
 *
 * @module plugins/board/ThreadView
 */

import type { BoardThreadDetail } from "./parser"
import { renderMarkdown, cardStyle, inputStyle, primaryBtn } from "./boardHelpers"
import { NewMessagesToast } from "../../components/ui/NewMessagesToast"

interface ThreadViewProps {
    threadDetail: BoardThreadDetail
    hasNewContent: boolean
    onDismissNew: () => void
    isAuthenticated: boolean
    replyBody: string
    onReplyChange: (body: string) => void
    onSubmitReply: () => void
    posting: boolean
    error?: string | null
}

export function ThreadView({
    threadDetail,
    hasNewContent,
    onDismissNew,
    isAuthenticated,
    replyBody,
    onReplyChange,
    onSubmitReply,
    posting,
    error,
}: ThreadViewProps) {
    return (
        <>
            {/* v2.5b: New messages toast */}
            <NewMessagesToast visible={hasNewContent} onDismiss={onDismissNew} />

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
            {isAuthenticated && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                    {error && <div style={{ color: "#ff3b30", fontSize: 12 }}>{error}</div>}
                    <div style={{ position: "relative" }}>
                        <textarea
                            id="board-reply-body"
                            placeholder="Write a reply (Markdown supported, use @g1... to mention)..."
                            value={replyBody}
                            onChange={e => onReplyChange(e.target.value)}
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
                        onClick={onSubmitReply}
                        disabled={posting || !replyBody.trim()}
                        style={{ ...primaryBtn, opacity: posting ? 0.5 : 1, alignSelf: "flex-start" }}
                    >
                        {posting ? "Posting..." : "Reply"}
                    </button>
                </div>
            )}
        </>
    )
}
