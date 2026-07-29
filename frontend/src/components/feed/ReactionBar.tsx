/**
 * ReactionBar — on-chain-optimistic reactions for a feed post. Shows the live
 * per-emoji counts (from the indexer's GetPostReactions), highlights the ones
 * the viewer left, and toggles a reaction with a single on-chain
 * AddReaction/RemoveReaction tx. A disconnected tap connects first.
 *
 * Gated by VITE_ENABLE_REACTIONS (off by default) — the feed realm must be
 * redeployed with the reaction methods before this can succeed, so it stays
 * dark until then even inside an otherwise feed-enabled build. The flag is
 * checked in the wrapper BEFORE any data hook, so a disabled build runs no
 * query (and PostCard needs no QueryClientProvider for it).
 *
 * @module components/feed/ReactionBar
 */
import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { fetchPostReactions } from "../../lib/feedApi"
import { buildAddReactionMsg, buildRemoveReactionMsg, submitFeedMsg, REACTION_EMOJIS } from "../../lib/feed"
import { isFeedWritable } from "../../lib/config"

interface ReactionBarProps {
    postId: bigint
    connected: boolean
    selfAddress?: string
    onConnect: () => void | Promise<boolean>
}

export function ReactionBar(props: ReactionBarProps) {
    if (import.meta.env.VITE_ENABLE_REACTIONS !== "true") return null
    // Off the indexed network every reaction would be refused by submitFeedMsg
    // and swallowed by the catch below, leaving buttons that look live and do
    // nothing forever. Don't render them.
    if (!isFeedWritable()) return null
    return <ReactionBarInner {...props} />
}

function ReactionBarInner({ postId, connected, selfAddress, onConnect }: ReactionBarProps) {
    const [picking, setPicking] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)

    const q = useQuery({
        queryKey: ["feed-reactions", postId.toString(), selfAddress ?? ""],
        queryFn: () => fetchPostReactions([postId], selfAddress),
        staleTime: 15_000,
        retry: false,
    })

    const counts = q.data?.get(postId) ?? []

    const toggle = async (emoji: string, reacted: boolean) => {
        if (!connected || !selfAddress) {
            await onConnect()
            return
        }
        setBusy(emoji)
        try {
            const msg = reacted
                ? buildRemoveReactionMsg(selfAddress, postId, emoji)
                : buildAddReactionMsg(selfAddress, postId, emoji)
            await submitFeedMsg(msg, reacted ? "feed: remove reaction" : "feed: react")
            await q.refetch()
        } catch {
            /* leave the counts as they were; the user can retry */
        } finally {
            setBusy(null)
            setPicking(false)
        }
    }

    return (
        <div className="feed-reactions" data-testid="feed-reactions">
            {counts.filter(c => c.count > 0).map(c => (
                <button
                    key={c.emoji}
                    type="button"
                    className={`feed-reaction${c.viewerReacted ? " feed-reaction--on" : ""}`}
                    disabled={busy === c.emoji}
                    aria-pressed={c.viewerReacted}
                    aria-label={`${c.emoji} ${c.count}`}
                    onClick={() => toggle(c.emoji, c.viewerReacted)}
                >
                    <span className="feed-reaction__emoji">{c.emoji}</span>
                    <span className="feed-reaction__count">{c.count}</span>
                </button>
            ))}
            <button
                type="button"
                className="feed-reaction feed-reaction--add"
                aria-label="Add reaction"
                aria-expanded={picking}
                data-testid="feed-reaction-add"
                onClick={() => setPicking(p => !p)}
            >
                <Plus size={13} />
            </button>
            {picking && (
                <div className="feed-reaction-picker" role="menu" data-testid="feed-reaction-picker">
                    {REACTION_EMOJIS.map(emoji => {
                        const reacted = counts.find(c => c.emoji === emoji)?.viewerReacted ?? false
                        return (
                            <button
                                key={emoji}
                                type="button"
                                role="menuitem"
                                className={`feed-reaction-pick${reacted ? " feed-reaction-pick--on" : ""}`}
                                disabled={busy === emoji}
                                onClick={() => toggle(emoji, reacted)}
                            >
                                {emoji}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
