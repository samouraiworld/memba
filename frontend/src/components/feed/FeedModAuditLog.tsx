import { useInfiniteQuery } from "@tanstack/react-query"
import { fetchModerationLog } from "../../lib/feedModerationApi"

const ACTION_LABEL: Record<string, string> = {
    flagged: "flagged",
    auto_hidden: "auto-hidden",
    mod_removed: "removed",
    mod_unhidden: "unhidden",
}

function shortAddr(a: string): string {
    return a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "—"
}

/**
 * The PUBLIC, body-free moderation audit log (feed v2 C.4/C.5). Renders ids +
 * actions + actor addresses only — never a post body, by construction (the RPC
 * carries none), so this surface can be shown without the bearer.
 *
 * `hideFlagger` masks the actor of community-flag events (shown as "community
 * flag") so the PUBLIC transparency page discloses *that* a post was flagged
 * without doxxing *who* flagged it (retaliation / chilling-effect guard).
 * Moderator actions still show the acting address — they carry accountability.
 * The moderation console (C.4) omits the prop, so operators see flaggers for
 * brigade review.
 */
export default function FeedModAuditLog({ hideFlagger = false }: { hideFlagger?: boolean }) {
    const q = useInfiniteQuery({
        queryKey: ["moderation", "log"],
        queryFn: ({ pageParam }) => fetchModerationLog(pageParam, 50),
        initialPageParam: 0n,
        getNextPageParam: (last) => (last.nextCursor > 0n ? last.nextCursor : undefined),
        retry: false,
    })
    const entries = q.data?.pages.flatMap((p) => p.entries) ?? []

    if (q.isLoading) return <p className="feed-mod__muted">Loading audit log…</p>
    if (q.isError) {
        return (
            <p className="feed-mod__error" role="alert">
                Couldn’t load the audit log.
            </p>
        )
    }
    if (entries.length === 0) return <p className="feed-mod__muted">No moderation events yet.</p>

    return (
        <ul className="feed-mod__log" aria-label="Moderation audit log entries">
            {entries.map((e) => (
                <li key={String(e.seq)} className="feed-mod__log-row">
                    <span className={`feed-mod__log-action feed-mod__log-action--${e.action}`}>
                        {ACTION_LABEL[e.action] ?? e.action}
                    </span>
                    <span className="feed-mod__log-post">post #{String(e.postId)}</span>
                    {hideFlagger && e.action === "flagged" ? (
                        <span className="feed-mod__log-actor">community flag</span>
                    ) : (
                        <span className="feed-mod__log-actor" title={e.actor}>
                            {shortAddr(e.actor)}
                        </span>
                    )}
                    <span className="feed-mod__log-block">@{String(e.blockH)}</span>
                </li>
            ))}
            {q.hasNextPage && (
                <li>
                    <button
                        type="button"
                        onClick={() => q.fetchNextPage()}
                        disabled={q.isFetchingNextPage}
                    >
                        {q.isFetchingNextPage ? "Loading…" : "Load older"}
                    </button>
                </li>
            )}
        </ul>
    )
}
