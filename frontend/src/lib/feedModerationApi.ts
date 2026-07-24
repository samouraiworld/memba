/**
 * feedModerationApi.ts — typed wrappers over the operator moderation surface
 * (feed v2 Wave C.4). UNLIKE feedApi.ts (which swallows every error into an empty
 * shape because the public feed may be undeployed), these calls PROPAGATE errors:
 * the flagged-post queue and the action endpoint are bearer-gated + fail-closed, so
 * a wrong/expired bearer returns 401/403/409 and MUST surface to the operator
 * (prompting a re-enter) rather than reading as an empty queue or a silent no-op.
 *
 * The bearer is the operator-pasted FEED_MODERATION_BEARER — never the user's
 * wallet login token — and is passed per-call, never stored on the shared client.
 *
 * @module lib/feedModerationApi
 */
import { api } from "./api"
import { API_BASE_URL } from "./config"
import type { FeedPost, ModerationLogEntry } from "../gen/memba/v1/memba_pb"

export type { FeedPost, ModerationLogEntry } from "../gen/memba/v1/memba_pb"

export type ModAction = "block" | "unblock" | "override_serve" | "clear_override"

export interface FlaggedPage {
    posts: FeedPost[]
    nextCursor: bigint
}

export interface ModLogPage {
    entries: ModerationLogEntry[]
    nextCursor: bigint
}

/**
 * The bearer-gated moderation QUEUE — flagged + hidden posts WITH bodies. The
 * operator secret is attached as a one-off per-call `Authorization` header; it
 * never touches the shared `api` client. Errors propagate (see module doc).
 */
export async function fetchFlaggedPosts(bearer: string, cursor = 0n, limit = 20): Promise<FlaggedPage> {
    const res = await api.getFlaggedPosts(
        { cursor, limit },
        { headers: { Authorization: `Bearer ${bearer}` } },
    )
    return { posts: res.posts ?? [], nextCursor: res.nextCursor ?? 0n }
}

/**
 * The PUBLIC, body-free moderation audit log. No auth header — the events are
 * already public on-chain and carry no post bodies. Errors propagate.
 */
export async function fetchModerationLog(cursor = 0n, limit = 50): Promise<ModLogPage> {
    const res = await api.getModerationLog({ cursor, limit })
    return { entries: res.entries ?? [], nextCursor: res.nextCursor ?? 0n }
}

/**
 * Perform one bearer-gated moderation action via POST /api/feed/moderation.
 * `post_id` is sent as a JSON NUMBER: the backend decodes it into a `uint64`
 * (`json:"post_id"`, no `,string` option), so a quoted string fails to unmarshal
 * and the action 400s. Feed post ids are sequential and far below 2^53, so a JS
 * number holds them exactly. Throws the backend's plain-text reason on any
 * non-2xx (e.g. a 409 when override_serve targets a deleted/blocklisted post).
 */
export async function postModeration(
    input: { postId: bigint; action: ModAction; reason?: string; by?: string },
    bearer: string,
): Promise<void> {
    const res = await fetch(`${API_BASE_URL || ""}/api/feed/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
            post_id: Number(input.postId),
            action: input.action,
            reason: input.reason ?? "",
            by: input.by ?? "",
        }),
    })
    if (!res.ok) {
        // The endpoint returns plain-text errors (http.Error), not JSON.
        const reason = (await res.text().catch(() => "")).trim()
        throw new Error(reason || `moderation failed (${res.status})`)
    }
}
