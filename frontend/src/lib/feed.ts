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
import { MEMBA_DAO } from "./config"
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

/** Broadcast a single feed MsgCall via Adena. Returns the tx hash. */
export async function submitFeedMsg(msg: AminoMsg, memo: string): Promise<string> {
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
