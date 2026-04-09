/**
 * ThreadList — Thread listing with unread indicators for a channel.
 *
 * Extracted from BoardView.tsx (v2.9 decomposition).
 *
 * @module plugins/board/ThreadList
 */

import type { BoardThread } from "./parser"
import { cardStyle, getLastVisited } from "./boardHelpers"
import { NewMessagesToast } from "../../components/ui/NewMessagesToast"
import { FlagButton } from "./FlagButton"

interface ThreadListProps {
    threads: BoardThread[]
    channel: string
    hasNewContent: boolean
    onDismissNew: () => void
    onSelectThread: (threadId: number) => void
    error?: string | null
    /** G2: Moderation props */
    boardPath?: string
    isMember?: boolean
    isAuthenticated?: boolean
    callerAddress?: string
    onFlagged?: () => void
}

export function ThreadList({
    threads,
    channel,
    hasNewContent,
    onDismissNew,
    onSelectThread,
    error,
    boardPath,
    isMember,
    isAuthenticated,
    callerAddress,
    onFlagged,
}: ThreadListProps) {
    return (
        <>
            {/* v2.5b: New messages toast */}
            <NewMessagesToast visible={hasNewContent} onDismiss={onDismissNew} />

            {error && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</div>}

            {threads.length === 0 ? (
                <div style={{ ...cardStyle, cursor: "default", textAlign: "center", padding: 24 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                        No threads yet. Be the first to post!
                    </div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {threads.map(t => (
                        <div
                            key={t.id}
                            id={`board-thread-${t.id}`}
                            onClick={() => onSelectThread(t.id)}
                            onKeyDown={(e) => e.key === "Enter" && onSelectThread(t.id)}
                            role="button"
                            tabIndex={0}
                            style={cardStyle}
                        >
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                {/* Unread indicator */}
                                {getLastVisited(channel, t.id) === 0 && (
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4aa", flexShrink: 0 }} />
                                )}
                                {t.title}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                    by {t.author} · {t.replyCount} repl{t.replyCount !== 1 ? "ies" : "y"} · block {t.blockHeight}
                                </div>
                                {boardPath && (
                                    <FlagButton
                                        boardPath={boardPath}
                                        channel={channel}
                                        threadId={t.id}
                                        isMember={!!isMember}
                                        isAuthenticated={!!isAuthenticated}
                                        callerAddress={callerAddress || ""}
                                        onFlagged={onFlagged}
                                    />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    )
}
