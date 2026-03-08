/**
 * Board ABCI Parser — queries and parses board/channel realm Render() output.
 *
 * Provides typed data structures for board threads, replies, and channels.
 * Uses the same ABCI query pattern as the DAO module (queryRender).
 *
 * v2.1a: Added support for channel types (text/announcements/readonly),
 * ACL roles, archived channels, edited/deleted messages, and @mentions.
 * Backward compatible with v1 _board realms.
 *
 * @module plugins/board/parser
 */

import { queryRender } from "../../lib/dao/shared"
import type { ChannelType } from "../../lib/channelTemplate"

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
    edited: boolean      // v2.1a: was the message edited?
    editedAt: number     // v2.1a: block height of last edit (0 if never)
    replies: BoardReply[]
}

export interface BoardReply {
    author: string       // truncated address
    body: string
    blockHeight: number
    edited: boolean      // v2.1a
}

export interface BoardChannel {
    name: string
    threadCount: number
    type: ChannelType    // v2.1a: "text" | "announcements" | "readonly"
    archived: boolean    // v2.1a
}

/** ACL info for a channel, parsed from __acl/ endpoint. */
export interface ChannelACLInfo {
    readRoles: string[]
    writeRoles: string[]
    type: ChannelType
}

export interface BoardInfo {
    name: string
    description: string
    channels: BoardChannel[]
}

// ── ABCI Queries ──────────────────────────────────────────────

/**
 * Fetch board home — channels list with thread counts.
 * Queries Render("") on the board/channel realm.
 */
export async function getBoardInfo(rpcUrl: string, boardPath: string): Promise<BoardInfo | null> {
    const raw = await queryRender(rpcUrl, boardPath, "")
    if (!raw) return null
    return parseBoardHome(raw)
}

/**
 * Fetch thread list for a channel.
 * Queries Render("{channelName}") on the board/channel realm.
 */
export async function getBoardThreads(rpcUrl: string, boardPath: string, channel: string): Promise<BoardThread[]> {
    const raw = await queryRender(rpcUrl, boardPath, channel)
    if (!raw) return []
    return parseThreadList(raw, channel)
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
): Promise<BoardThreadDetail | null> {
    const raw = await queryRender(rpcUrl, boardPath, `${channel}/${threadId}`)
    if (!raw) return null
    return parseThreadDetail(raw, channel, threadId)
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
 * v2.1a: Check if a channel realm exists (tries _channels suffix first, falls back to _board).
 * Returns the realm path that exists, or null if neither.
 */
export async function detectChannelRealm(rpcUrl: string, daoRealmPath: string): Promise<string | null> {
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
): Promise<ChannelACLInfo | null> {
    const raw = await queryRender(rpcUrl, channelRealmPath, `__acl/${channelName}`)
    if (!raw || raw.includes("not found")) return null
    return parseACL(raw)
}

// ── Parsers ───────────────────────────────────────────────────

/**
 * Parse board home Render output.
 *
 * v1 format:
 * ```
 * - [#general](:general) (3 threads)
 * ```
 *
 * v2.1a format (channels):
 * ```
 * - [#general](:_channel/general) 📢 (3 threads)
 * - [#dev](:_channel/dev) (0 threads)
 * ```
 */
export function parseBoardHome(raw: string): BoardInfo {
    const lines = raw.split("\n")
    const name = (lines.find(l => l.startsWith("# ")) || "# Board").replace(/^# /, "").trim()

    // Description is the line(s) between the title and ## Channels
    const channelsIdx = lines.findIndex(l => l.startsWith("## Channels"))
    const descLines = lines.slice(1, channelsIdx > 0 ? channelsIdx : 3).filter(l => l.trim().length > 0)
    const description = descLines.join(" ").trim()

    // Parse channel list items — supports both v1 and v2.1a formats
    // v2.1a: - [#name](:_channel/name) 📢 (N threads)
    // v1:    - [#name](:name) (N threads)
    const channelPattern = /- \[#([^\]]+)\]\([^)]+\)\s*(📢|🔒)?\s*\((\d+)\s*threads?\)/gu
    const channels: BoardChannel[] = []
    let match
    while ((match = channelPattern.exec(raw)) !== null) {
        const typeIndicator = match[2] || ""
        let type: ChannelType = "text"
        if (typeIndicator === "📢") type = "announcements"
        else if (typeIndicator === "🔒") type = "readonly"
        channels.push({
            name: match[1],
            threadCount: parseInt(match[3], 10),
            type,
            archived: false,
        })
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
 * v2.1a additions:
 * - Detects "(edited at block N)" markers
 * - Detects "[Deleted]" thread title
 * - Replies can have "(edited)" markers
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

    // Author: *Posted by g1... at block N* *(edited at block M)*
    const authorMatch = raw.match(/\*Posted by (g1[a-z0-9]+) at block (\d+)\*/)
    const author = authorMatch ? authorMatch[1] : "unknown"
    const blockHeight = authorMatch ? parseInt(authorMatch[2], 10) : 0

    // v2.1a: Check for edit marker
    const editMatch = raw.match(/\*\(edited at block (\d+)\)\*/)
    const edited = editMatch !== null
    const editedAt = editMatch ? parseInt(editMatch[1], 10) : 0

    // Replies section
    const replies: BoardReply[] = []
    const repliesIdx = raw.indexOf("## Replies")
    if (repliesIdx >= 0) {
        const repliesSection = raw.slice(repliesIdx)
        // Parse reply blocks: **author...** (block N) *(edited)*\n\nbody\n\n---
        const replyPattern = /\*\*([^*]+)\*\*\s*\(block\s+(\d+)\)\s*(\*\(edited\)\*)?\s*\n\n([\s\S]*?)(?:\n\n---|\n*$)/g
        let replyMatch
        while ((replyMatch = replyPattern.exec(repliesSection)) !== null) {
            replies.push({
                author: replyMatch[1].trim(),
                blockHeight: parseInt(replyMatch[2], 10),
                body: replyMatch[4].trim(),
                edited: !!replyMatch[3],
            })
        }
    }

    return { id: threadId, channel, title, body, author, blockHeight, edited, editedAt, replies }
}

/**
 * v2.1a: Parse ACL response from Render("__acl/{channel}").
 *
 * Expected format:
 * ```
 * read:admin,dev
 * write:admin,dev,member
 * type:text
 * ```
 */
export function parseACL(raw: string): ChannelACLInfo {
    const lines = raw.split("\n")
    const readLine = lines.find(l => l.startsWith("read:"))
    const writeLine = lines.find(l => l.startsWith("write:"))
    const typeLine = lines.find(l => l.startsWith("type:"))

    const readRoles = readLine ? readLine.replace("read:", "").split(",").filter(Boolean) : []
    const writeRoles = writeLine ? writeLine.replace("write:", "").split(",").filter(Boolean) : []
    const type = (typeLine ? typeLine.replace("type:", "").trim() : "text") as ChannelType

    return { readRoles, writeRoles, type }
}

/**
 * v2.1a: Extract @mentions from a message body.
 * Returns array of unique g1... addresses mentioned.
 */
export function parseMentions(body: string): string[] {
    const mentionPattern = /@(g1[a-z0-9]{38})/g
    const mentions = new Set<string>()
    let match
    while ((match = mentionPattern.exec(body)) !== null) {
        mentions.add(match[1])
    }
    return Array.from(mentions)
}
