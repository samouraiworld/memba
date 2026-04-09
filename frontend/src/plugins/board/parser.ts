/**
 * Board ABCI Parser — queries and parses board/channel realm Render() output.
 *
 * Provides typed data structures for board threads, replies, and channels.
 * Uses the same ABCI query pattern as the DAO module (queryRender).
 *
 * Architecture: Strategy pattern with V1/V2 parser versions.
 * - V1 (parserV1.ts): Current regex-based parser for test12/betanet.
 * - V2 (parserV2.ts): Placeholder for boards2 hub format (gno#5037).
 * - getActiveBoardParser(): Returns the active parser version.
 *
 * v2.1a: Added support for channel types (text/announcements/readonly),
 * ACL roles, archived channels, edited/deleted messages, and @mentions.
 * Backward compatible with v1 _board realms.
 *
 * @module plugins/board/parser
 */

import { queryRender } from "../../lib/dao/shared"
import type { BoardParser } from "./types"
import { boardParserV1 } from "./parserV1"

// ── Re-exports (public API — preserves all existing import paths) ──

export type {
    BoardThread,
    BoardThreadDetail,
    BoardReply,
    BoardChannel,
    ChannelACLInfo,
    BoardInfo,
    BoardParser,
} from "./types"

// Re-export V1 parse functions for direct use in tests and legacy consumers.
export {
    parseBoardHome,
    parseThreadList,
    parseThreadDetail,
    parseACL,
    parseMentions,
} from "./parserV1"

// ── Parser Version Selection ─────────────────────────────────

/**
 * Returns the active board parser for the current chain.
 *
 * Currently always returns V1. When boards2 hub (gno#5037) merges and
 * changes the Render() format, this function will detect the format
 * and return V2.
 *
 * Detection strategy (future):
 * 1. Query the board realm's Render("") output
 * 2. Check for V2-specific markers (e.g., JSON responses, hub metadata)
 * 3. Fall back to V1 if V2 markers not found
 */
export function getActiveBoardParser(): BoardParser {
    // V1 is the only production parser until gno#5037 merges.
    return boardParserV1
}

// ── ABCI Queries ──────────────────────────────────────────────

/**
 * Fetch board home — channels list with thread counts.
 * Queries Render("") on the board/channel realm.
 */
export async function getBoardInfo(rpcUrl: string, boardPath: string): Promise<import("./types").BoardInfo | null> {
    const raw = await queryRender(rpcUrl, boardPath, "")
    if (!raw) return null
    return getActiveBoardParser().parseBoardHome(raw)
}

/**
 * Fetch thread list for a channel.
 * Queries Render("{channelName}") on the board/channel realm.
 */
export async function getBoardThreads(rpcUrl: string, boardPath: string, channel: string): Promise<import("./types").BoardThread[]> {
    const raw = await queryRender(rpcUrl, boardPath, channel)
    if (!raw) return []
    return getActiveBoardParser().parseThreadList(raw, channel)
}

/**
 * Fetch a single thread with replies.
 * Queries Render("{channelName}/{threadId}") on the board/channel realm.
 */
export async function getBoardThread(
    rpcUrl: string,
    boardPath: string,
    channel: string,
    threadId: number,
): Promise<import("./types").BoardThreadDetail | null> {
    const raw = await queryRender(rpcUrl, boardPath, `${channel}/${threadId}`)
    if (!raw) return null
    return getActiveBoardParser().parseThreadDetail(raw, channel, threadId)
}

/**
 * Check if a board/channel realm exists by querying its Render("").
 * Returns true if the realm responds, false if 404/error.
 */
export async function boardExists(rpcUrl: string, boardPath: string): Promise<boolean> {
    const raw = await queryRender(rpcUrl, boardPath, "")
    return raw !== null && !raw.includes("404")
}

/**
 * v2.1a: Check if a channel realm exists.
 * Tries the configured MEMBA_DAO.channelsPath first (v2), then falls back to
 * suffix-based detection (_channels, _board) for compatibility.
 */
export async function detectChannelRealm(rpcUrl: string, daoRealmPath: string): Promise<string | null> {
    // Try the centrally-configured channels path first (supports v2 paths)
    const { MEMBA_DAO } = await import("../../lib/config")
    if (await boardExists(rpcUrl, MEMBA_DAO.channelsPath)) return MEMBA_DAO.channelsPath
    // Fallback: try suffix-based detection for other DAOs
    const channelsPath = `${daoRealmPath}_channels`
    if (await boardExists(rpcUrl, channelsPath)) return channelsPath
    const boardPath = `${daoRealmPath}_board`
    if (await boardExists(rpcUrl, boardPath)) return boardPath
    return null
}

/**
 * v2.1a: Fetch channel ACL info.
 * Queries Render("__acl/{channelName}") on the channel realm.
 */
export async function getChannelACL(
    rpcUrl: string,
    channelRealmPath: string,
    channelName: string,
): Promise<import("./types").ChannelACLInfo | null> {
    const raw = await queryRender(rpcUrl, channelRealmPath, `__acl/${channelName}`)
    if (!raw || raw.includes("not found")) return null
    return getActiveBoardParser().parseACL(raw)
}
