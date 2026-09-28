/**
 * FeedbackFeed — Memba community feedback via board realm.
 *
 * Thin wrapper reusing the Board plugin ABCI parser to display
 * the r/samcrew/memba_feedback board realm threads.
 *
 * Linked from footer and Settings page.
 *
 * @module components/FeedbackFeed
 */

import { useState, useEffect } from "react"
import { parseThreadList } from "../plugins/board/parser"
import type { BoardThread } from "../plugins/board/parser"
import { GNO_RPC_URL, FEEDBACK_REALM_PATH, isFeedbackValid } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import { useWindowActive } from "../os/page/WindowActivity"

// Current mainnet Render("general") shape for a valid empty feedback board.
// A changed or malformed response must not silently become "no posts".
const EMPTY_BOARD = "# #general\n\n*No threads yet. Be the first to post!*"

export function FeedbackFeed() {
    // The feedback board realm isn't valid on every network (e.g. test13). When
    // it isn't, skip the fetch entirely: a query there returns [] (no throw),
    // which would misleadingly render "No feedback yet" instead of the
    // unavailable notice. Derive initial state from validity so we don't call
    // setState synchronously inside the effect.
    const realmValid = isFeedbackValid()
    const windowActive = useWindowActive()
    const [threads, setThreads] = useState<BoardThread[]>([])
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

    useEffect(() => {
        if (!realmValid || !windowActive || status !== "loading") return
        let cancelled = false
        queryRender(GNO_RPC_URL, FEEDBACK_REALM_PATH, "general")
            .then(raw => {
                if (cancelled) return
                // The shared board helper maps a failed or absent render to [].
                // Here that would falsely claim the live board has no posts.
                if (!raw || raw.trim() === "404") {
                    setStatus("error")
                    return
                }
                const parsed = parseThreadList(raw, "general")
                if (parsed.length === 0 && raw.trim() !== EMPTY_BOARD) {
                    setStatus("error")
                    return
                }
                setThreads(parsed)
                setStatus("ready")
            })
            .catch(() => { if (!cancelled) setStatus("error") })
        return () => { cancelled = true }
    }, [realmValid, windowActive, status])

    if (!realmValid) return null

    if (status === "loading") {
        return (
            <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                {[1, 2].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 48, borderRadius: 8, background: "var(--color-border)" }} />
                ))}
            </div>
        )
    }

    if (status === "error") {
        return (
            <div id="feedback-unavailable" role="alert" style={{
                padding: "16px 20px",
                borderRadius: 10,
                background: "rgba(245,166,35,0.03)",
                border: "1px solid rgba(245,166,35,0.1)",
                fontSize: "var(--pro-small, 12px)",
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
            }}>
                <p style={{ margin: "0 0 10px" }}>Community feedback could not be loaded right now.</p>
                <button type="button" className="feedback-retry" onClick={() => setStatus("loading")}>
                    Retry
                </button>
            </div>
        )
    }

    return (
        <div id="feedback-feed" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>📝</span>
                <h2 style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    On-chain feedback preview
                </h2>
            </div>
            <p style={{ margin: 0, fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)" }}>
                This board is read only in Memba. Use GitHub Issues above to submit a bug or idea.
            </p>

            {threads.length === 0 ? (
                <div style={{
                    padding: "12px 16px", borderRadius: 8,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)",
                    fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                }}>
                    No on-chain feedback has been posted yet. Share a bug or idea through GitHub Issues above.
                </div>
            ) : (
                threads.slice(0, 5).map(t => (
                    <div key={t.id} style={{
                        padding: "10px 14px", borderRadius: 8,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                        <div style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)" }}>
                            {t.title}
                        </div>
                        <div style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-muted)", marginTop: 4, fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                            by {t.author} · {t.replyCount} replies
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
