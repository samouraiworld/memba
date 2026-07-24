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
 * The PUBLIC, body-free moderation audit log (feed v2 C.5/C.4). Renders ids +
 * actions + actor addresses only — never a post body, by construction (the RPC
 * carries none), so this surface can be shown without the bearer.
 */
export default function FeedModAuditLog() {
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
                    <span className="feed-mod__log-actor" title={e.actor}>
                        {shortAddr(e.actor)}
                    </span>
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
