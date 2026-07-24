/**
 * feed.ts — Adena MsgCall builders + broadcast for the memba_feed_v1 realm.
 *
 * These target the feed realm's user-callable crossing functions
 * (CreatePost / EditPost / DeletePost / FlagPost). Reads go through feedApi.ts
 * (the indexed backend projection); this module is write-only.
 *
 * Mirrors the reviews realm's builder pattern (buildReviewMsgCall + submitMsg)
 * — a single vm/MsgCall broadcast via the ordinary Adena flow. It does NOT
 * touch any multisig signing path.
 *
 * @module lib/feed
 */
import { MEMBA_DAO, FEED_INDEXED_NETWORK, NETWORKS, isFeedWritable } from "./config"
import { doContractBroadcast, type AminoMsg } from "./grc20"

export const FEED_PKG_PATH = MEMBA_DAO.feedPath

function buildFeedMsgCall(func: string, args: string[], caller: string): AminoMsg {
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: FEED_PKG_PATH, func, args } }
}

/** CreatePost(body, replyTo). replyTo 0 = top-level post. Accepts a bigint so a
 *  reply id past 2^53 round-trips exactly (String(42n) === "42", no `n`). */
export function buildCreatePostMsg(caller: string, body: string, replyTo: bigint | number = 0): AminoMsg {
    return buildFeedMsgCall("CreatePost", [body, String(replyTo)], caller)
}

/** EditPost(id, newBody). Not yet wired to UI — the P1 feed has no edit
 *  affordance; kept as the ready builder for the next feed increment (tested). */
export function buildEditPostMsg(caller: string, id: bigint, newBody: string): AminoMsg {
    return buildFeedMsgCall("EditPost", [id.toString(), newBody], caller)
}

/** DeletePost(id) — author tombstone. Not yet wired to UI (see buildEditPostMsg). */
export function buildDeletePostMsg(caller: string, id: bigint): AminoMsg {
    return buildFeedMsgCall("DeletePost", [id.toString()], caller)
}

/** FlagPost(id) — community flag; auto-hides past the realm threshold. */
export function buildFlagPostMsg(caller: string, id: bigint): AminoMsg {
    return buildFeedMsgCall("FlagPost", [id.toString()], caller)
}

/** AddReaction(id, emoji) — one-per-emoji reaction (optimistic; toggle-off via RemoveReaction). */
export function buildAddReactionMsg(caller: string, id: bigint, emoji: string): AminoMsg {
    return buildFeedMsgCall("AddReaction", [id.toString(), emoji], caller)
}

/** RemoveReaction(id, emoji) — retract a previously-added reaction. */
export function buildRemoveReactionMsg(caller: string, id: bigint, emoji: string): AminoMsg {
    return buildFeedMsgCall("RemoveReaction", [id.toString(), emoji], caller)
}

/** The realm's fixed reaction set (must match memba_feed_v1.reactionEmojis). */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "🚀"] as const

/** Human-readable label for the one chain whose feed the backend indexes. */
export const FEED_INDEXED_NETWORK_LABEL =
    NETWORKS[FEED_INDEXED_NETWORK]?.label ?? FEED_INDEXED_NETWORK

/**
 * Broadcast a single feed MsgCall via Adena. Returns the tx hash.
 *
 * Refuses outright when the active network is not the one the backend indexes.
 * The feed realm path is identical on every network Memba allowlists it on, so
 * without this guard a write on another chain SUCCEEDS: the user pays gas, the
 * post is permanent on-chain, and it is invisible everywhere in the product
 * because the indexer never sees it. Flag/delete are worse still — they carry a
 * post id that identifies a DIFFERENT post on the other chain.
 *
 * Every feed write funnels through here (post, reply, edit, delete, flag,
 * react), so this one check covers all of them, including future callers. The
 * UI gates too, but this is the backstop that makes the bug unrepresentable
 * rather than merely unlikely.
 */
export async function submitFeedMsg(msg: AminoMsg, memo: string): Promise<string> {
    if (!isFeedWritable()) {
        throw new Error(
            `The feed is not indexed on this network — switch to ${FEED_INDEXED_NETWORK_LABEL} to post. ` +
            `A post made here would cost gas and never appear.`,
        )
    }
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
