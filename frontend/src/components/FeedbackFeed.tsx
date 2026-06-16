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
import { getBoardThreads } from "../plugins/board/parser"
import type { BoardThread } from "../plugins/board/parser"
import { GNO_RPC_URL, FEEDBACK_REALM_PATH, isFeedbackValid } from "../lib/config"

export function FeedbackFeed() {
    // The feedback board realm isn't valid on every network (e.g. test13). When
    // it isn't, skip the fetch entirely: a query there returns [] (no throw),
    // which would misleadingly render "No feedback yet" instead of the
    // unavailable notice. Derive initial state from validity so we don't call
    // setState synchronously inside the effect.
    const realmValid = isFeedbackValid()
    const [threads, setThreads] = useState<BoardThread[]>([])
    const [loading, setLoading] = useState(realmValid)
    const [available, setAvailable] = useState(realmValid)

    useEffect(() => {
        if (!realmValid) return
        getBoardThreads(GNO_RPC_URL, FEEDBACK_REALM_PATH, "general")
            .then(t => { setThreads(t); setAvailable(true) })
            .catch(() => setAvailable(false))
            .finally(() => setLoading(false))
    }, [realmValid])

    if (loading) {
        return (
            <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                {[1, 2].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 48, borderRadius: 8, background: "var(--color-border)" }} />
                ))}
            </div>
        )
    }

    if (!available) {
        return (
            <div id="feedback-unavailable" style={{
                padding: "16px 20px",
                borderRadius: 10,
                background: "rgba(245,166,35,0.03)",
                border: "1px solid rgba(245,166,35,0.1)",
                fontSize: 12,
                color: "var(--color-text-secondary)",
                fontFamily: "JetBrains Mono, monospace",
            }}>
                📝 On-chain feedback board will be deployed on betanet. In the meantime, submit feedback via GitHub Issues above.
            </div>
        )
    }

    return (
        <div id="feedback-feed" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>📝</span>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    Community Feedback
                </h4>
            </div>

            {threads.length === 0 ? (
                <div style={{
                    padding: "12px 16px", borderRadius: 8,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 11, color: "var(--color-text-secondary)",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    No feedback yet. Be the first!
                </div>
            ) : (
                threads.slice(0, 5).map(t => (
                    <div key={t.id} style={{
                        padding: "10px 14px", borderRadius: 8,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                            {t.title}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            by {t.author} · {t.replyCount} replies
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
