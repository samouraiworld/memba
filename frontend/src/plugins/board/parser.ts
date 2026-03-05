/**
 * Board ABCI Parser — queries and parses board realm Render() output.
 *
 * Provides typed data structures for board threads, replies, and channels.
 * Uses the same ABCI query pattern as the DAO module (queryRender).
 *
 * @module plugins/board/parser
 */

import { queryRender } from "../../lib/dao/shared"

// ── Types ─────────────────────────────────────────────────────

export interface BoardThread {
    id: number
    channel: string
    title: string
    author: string       // truncated address from render
    replyCount: number
    blockHeight: number
}

export interface BoardThreadDetail {
    id: number
    channel: string
    title: string
    body: string         // Markdown content
    author: string       // full address
    blockHeight: number
    replies: BoardReply[]
}

export interface BoardReply {
    author: string       // truncated address
    body: string
    blockHeight: number
}

export interface BoardChannel {
    name: string
    threadCount: number
}

export interface BoardInfo {
    name: string
    description: string
    channels: BoardChannel[]
}

// ── ABCI Queries ──────────────────────────────────────────────

/**
 * Fetch board home — channels list with thread counts.
 * Queries Render("") on the board realm.
 */
export async function getBoardInfo(rpcUrl: string, boardPath: string): Promise<BoardInfo | null> {
    const raw = await queryRender(rpcUrl, boardPath, "")
    if (!raw) return null
    return parseBoardHome(raw)
}

/**
 * Fetch thread list for a channel.
 * Queries Render("{channelName}") on the board realm.
 */
export async function getBoardThreads(rpcUrl: string, boardPath: string, channel: string): Promise<BoardThread[]> {
    const raw = await queryRender(rpcUrl, boardPath, channel)
    if (!raw) return []
    return parseThreadList(raw, channel)
}

/**
 * Fetch a single thread with replies.
 * Queries Render("{channelName}/{threadId}") on the board realm.
 */
export async function getBoardThread(
    rpcUrl: string,
    boardPath: string,
    channel: string,
    threadId: number,
): Promise<BoardThreadDetail | null> {
    const raw = await queryRender(rpcUrl, boardPath, `${channel}/${threadId}`)
    if (!raw) return null
    return parseThreadDetail(raw, channel, threadId)
}

/**
 * Check if a board realm exists by querying its Render("").
 * Returns true if the realm responds (board deployed), false if 404/error.
 */
export async function boardExists(rpcUrl: string, boardPath: string): Promise<boolean> {
    const raw = await queryRender(rpcUrl, boardPath, "")
    return raw !== null && !raw.includes("404")
}

// ── Parsers ───────────────────────────────────────────────────

/**
 * Parse board home Render output.
 *
 * Expected format:
 * ```
 * # Board Name
 *
 * Board description
 *
 * ## Channels
 *
 * - [#general](:general) (3 threads)
 * - [#dev](:dev) (0 threads)
 * ```
 */
export function parseBoardHome(raw: string): BoardInfo {
    const lines = raw.split("\n")
    const name = (lines.find(l => l.startsWith("# ")) || "# Board").replace(/^# /, "").trim()

    // Description is the line(s) between the title and ## Channels
    const channelsIdx = lines.findIndex(l => l.startsWith("## Channels"))
    const descLines = lines.slice(1, channelsIdx > 0 ? channelsIdx : 3).filter(l => l.trim().length > 0)
    const description = descLines.join(" ").trim()

    // Parse channel list items: - [#name](:name) (N threads)
    const channelPattern = /- \[#([^\]]+)\]\([^)]+\)\s*\((\d+)\s*threads?\)/g
    const channels: BoardChannel[] = []
    let match
    while ((match = channelPattern.exec(raw)) !== null) {
        channels.push({ name: match[1], threadCount: parseInt(match[2], 10) })
    }

    return { name, description, channels }
}

/**
 * Parse channel thread list from Render output.
 *
 * Expected format:
 * ```
 * # #general
 *
 * ### [Thread Title](:general/0)
 * by g1abc12345... | 2 replies | block 12345
 *
 * ### [Another Thread](:general/1)
 * by g1def67890... | 0 replies | block 12350
 * ```
 */
export function parseThreadList(raw: string, channel: string): BoardThread[] {
    const threads: BoardThread[] = []
    const threadPattern = /### \[([^\]]+)\]\(:([^/]+)\/(\d+)\)\s*\n([^\n]*)/g
    let match
    while ((match = threadPattern.exec(raw)) !== null) {
        const title = match[1]
        const id = parseInt(match[3], 10)
        const meta = match[4] || ""

        // Parse meta line: "by g1abc... | 2 replies | block 12345"
        const authorMatch = meta.match(/by\s+(g1[a-z0-9]+\.{0,3})/)
        const repliesMatch = meta.match(/(\d+)\s*replies?/)
        const blockMatch = meta.match(/block\s+(\d+)/)

        threads.push({
            id,
            channel,
            title,
            author: authorMatch ? authorMatch[1] : "unknown",
            replyCount: repliesMatch ? parseInt(repliesMatch[1], 10) : 0,
            blockHeight: blockMatch ? parseInt(blockMatch[1], 10) : 0,
        })
    }
    return threads
}

/**
 * Parse a single thread detail from Render output.
 *
 * Expected format:
 * ```
 * # Thread Title
 *
 * Body content here (Markdown)
 *
 * ---
 * *Posted by g1fulladdress at block 12345*
 *
 * ## Replies (2)
 *
 * **g1abc12345...** (block 12350)
 *
 * Reply body here
 *
 * ---
 * ```
 */
export function parseThreadDetail(raw: string, channel: string, threadId: number): BoardThreadDetail {
    const lines = raw.split("\n")

    // Title: first # heading
    const title = (lines.find(l => l.startsWith("# ")) || "# Untitled").replace(/^# /, "").trim()

    // Find the separator before author info
    const separatorIdx = lines.indexOf("---")
    const body = lines
        .slice(1, separatorIdx > 0 ? separatorIdx : lines.length)
        .join("\n")
        .trim()

    // Author: *Posted by g1... at block N*
    const authorMatch = raw.match(/\*Posted by (g1[a-z0-9]+) at block (\d+)\*/)
    const author = authorMatch ? authorMatch[1] : "unknown"
    const blockHeight = authorMatch ? parseInt(authorMatch[2], 10) : 0

    // Replies section
    const replies: BoardReply[] = []
    const repliesIdx = raw.indexOf("## Replies")
    if (repliesIdx >= 0) {
        const repliesSection = raw.slice(repliesIdx)
        // Parse reply blocks: **author...** (block N)\n\nbody\n\n---
        const replyPattern = /\*\*([^*]+)\*\*\s*\(block\s+(\d+)\)\s*\n\n([\s\S]*?)(?:\n\n---|\n*$)/g
        let replyMatch
        while ((replyMatch = replyPattern.exec(repliesSection)) !== null) {
            replies.push({
                author: replyMatch[1].trim(),
                blockHeight: parseInt(replyMatch[2], 10),
                body: replyMatch[3].trim(),
            })
        }
    }

    return { id: threadId, channel, title, body, author, blockHeight, replies }
}
