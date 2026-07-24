import { useState } from "react"
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { fetchFlaggedPosts, postModeration, type ModAction, type FeedPost } from "../../lib/feedModerationApi"

const LIMIT = 20

const ACTIONS: { label: string; action: ModAction }[] = [
    { label: "Restore", action: "override_serve" },
    { label: "Clear override", action: "clear_override" },
    { label: "Block", action: "block" },
    { label: "Unblock", action: "unblock" },
]

function shortAddr(a: string): string {
    return a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "—"
}

/**
 * The bearer-gated moderation QUEUE. Unlike PostCard (which tombstones hidden /
 * deleted posts and hides their body), this renders every flagged post's body as
 * escaped plain text — a moderator must read what was flagged to act on it. Errors
 * surface (a wrong/expired bearer prompts a re-enter) rather than showing an empty
 * queue. `bearer` is the operator secret, forwarded per-call, never persisted here.
 */
export default function FeedModQueue({ bearer, by }: { bearer: string; by?: string }) {
    const qc = useQueryClient()
    const [actionError, setActionError] = useState("")

    const q = useInfiniteQuery({
        // Key on the bearer's PRESENCE, never its value (no secret in cache keys).
        queryKey: ["moderation", "flagged", bearer.length > 0],
        queryFn: ({ pageParam }) => fetchFlaggedPosts(bearer, pageParam, LIMIT),
        initialPageParam: 0n,
        getNextPageParam: (last) => (last.nextCursor > 0n ? last.nextCursor : undefined),
        retry: false,
        enabled: bearer.length > 0,
    })

    const act = useMutation({
        mutationFn: (v: { postId: bigint; action: ModAction }) => postModeration({ ...v, by }, bearer),
        onSuccess: () => {
            setActionError("")
            void qc.invalidateQueries({ queryKey: ["moderation"] })
        },
        onError: (e: unknown) => setActionError(e instanceof Error ? e.message : "Action failed."),
    })

    const posts = q.data?.pages.flatMap((p) => p.posts) ?? []

    if (q.isLoading) return <p className="feed-mod__muted">Loading flagged posts…</p>
    if (q.isError) {
        return (
            <p className="feed-mod__error" role="alert">
                Couldn’t load the queue — the bearer may be wrong or expired. Clear it and re-enter it above.
            </p>
        )
    }
    if (posts.length === 0) return <p className="feed-mod__muted">Nothing in the moderation queue.</p>

    return (
        <div>
            {actionError && (
                <p className="feed-mod__error" role="alert">
                    {actionError}
                </p>
            )}
            <ul className="feed-mod__queue">
                {posts.map((post: FeedPost) => (
                    <li key={String(post.id)} className="feed-mod__row">
                        <header className="feed-mod__row-head">
                            <span className="feed-mod__row-author" title={post.author}>
                                {shortAddr(post.author)}
                            </span>
                            <span className="feed-mod__row-id">#{String(post.id)}</span>
                            <span className="feed-mod__row-flags">
                                <span role="img" aria-label="flags">🚩</span> {post.flagCount}
                            </span>
                            {post.hidden && <span className="feed-mod__badge feed-mod__badge--hidden">hidden</span>}
                            {post.deleted && <span className="feed-mod__badge feed-mod__badge--deleted">deleted</span>}
                        </header>
                        {/* Moderator must read the raw content — escaped plain text, never a tombstone. */}
                        <p className="feed-mod__row-body">{post.body}</p>
                        <div className="feed-mod__row-actions">
                            {ACTIONS.map(({ label, action }) => (
                                <button
                                    key={action}
                                    type="button"
                                    aria-label={`${label} post #${String(post.id)}`}
                                    disabled={act.isPending}
                                    onClick={() => act.mutate({ postId: post.id, action })}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </li>
                ))}
            </ul>
            {q.hasNextPage && (
                <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                    {q.isFetchingNextPage ? "Loading…" : "Load older"}
                </button>
            )}
        </div>
    )
}
