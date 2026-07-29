import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useModeratorBearer } from "../hooks/useModeratorBearer"
import FeedModQueue from "../components/feed/FeedModQueue"
import FeedModAuditLog from "../components/feed/FeedModAuditLog"
import "./feed.css"
import "./feed-mod.css"

/**
 * Feed moderation console (feed v2 Wave C.4), mounted at /:network/feed/mod behind
 * VITE_ENABLE_FEED. The operator pastes the FEED_MODERATION_BEARER (kept in this tab
 * only — see useModeratorBearer); it gates the flagged queue + the action buttons.
 * The audit log is public and always shown. The client gate is UX only — the backend
 * is fail-closed and authoritative.
 */
export default function FeedMod() {
    const qc = useQueryClient()
    const { bearer, setBearer, clearBearer, hasBearer } = useModeratorBearer()
    const [draft, setDraft] = useState("")
    const [moderator, setModerator] = useState("")

    return (
        <main className="feed-mod">
            <h1>Feed moderation</h1>

            <section className="feed-mod__bearer">
                <label htmlFor="feed-mod-bearer">Moderation bearer</label>
                <input
                    id="feed-mod-bearer"
                    type="password"
                    placeholder="Paste the FEED_MODERATION_BEARER"
                    value={hasBearer ? "" : draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={hasBearer}
                    autoComplete="off"
                    spellCheck={false}
                />
                {hasBearer ? (
                    <button
                        type="button"
                        onClick={() => {
                            clearBearer()
                            setDraft("")
                            // Drop the cached flagged-post bodies along with the bearer.
                            qc.removeQueries({ queryKey: ["moderation", "flagged"] })
                        }}
                    >
                        Clear bearer
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            setBearer(draft)
                            setDraft("") // don't retain the pasted secret in draft state
                        }}
                        disabled={!draft.trim()}
                    >
                        Load queue
                    </button>
                )}
                <label htmlFor="feed-mod-by" className="feed-mod__by-label">
                    Your moderator label (recorded in the audit log)
                </label>
                <input
                    id="feed-mod-by"
                    type="text"
                    placeholder="e.g. ops:antoine"
                    value={moderator}
                    onChange={(e) => setModerator(e.target.value)}
                    autoComplete="off"
                />
                <p className="feed-mod__muted feed-mod__bearer-note">
                    Kept in this browser tab only (sessionStorage) — never saved to the browser or baked into the app.
                </p>
            </section>

            {hasBearer && (
                <section aria-label="Flagged queue">
                    <h2>Flagged queue</h2>
                    <FeedModQueue bearer={bearer} by={moderator} />
                </section>
            )}

            <section aria-label="Moderation audit log">
                <h2>Audit log</h2>
                <FeedModAuditLog />
            </section>
        </main>
    )
}
