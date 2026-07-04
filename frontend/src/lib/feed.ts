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

/** CreatePost(body, replyTo). replyTo 0 = top-level post. */
export function buildCreatePostMsg(caller: string, body: string, replyTo = 0): AminoMsg {
    return buildFeedMsgCall("CreatePost", [body, String(replyTo)], caller)
}

/** EditPost(id, newBody). */
export function buildEditPostMsg(caller: string, id: bigint, newBody: string): AminoMsg {
    return buildFeedMsgCall("EditPost", [id.toString(), newBody], caller)
}

/** DeletePost(id) — author tombstone. */
export function buildDeletePostMsg(caller: string, id: bigint): AminoMsg {
    return buildFeedMsgCall("DeletePost", [id.toString()], caller)
}

/** FlagPost(id) — community flag; auto-hides past the realm threshold. */
export function buildFlagPostMsg(caller: string, id: bigint): AminoMsg {
    return buildFeedMsgCall("FlagPost", [id.toString()], caller)
}

/** Broadcast a single feed MsgCall via Adena. Returns the tx hash. */
export async function submitFeedMsg(msg: AminoMsg, memo: string): Promise<string> {
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
