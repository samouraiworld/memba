/**
 * Board Parser V1 — regex-based parser for current Render() format.
 *
 * Handles both v1 (_board) and v2.1a (_channels) realm output.
 * This is the production parser for test12/betanet until boards2 hub
 * (gno#5037) changes the Render() format.
 *
 * @module plugins/board/parserV1
 */

import type { ChannelType } from "../../lib/channelTemplate"
import type {
    BoardParser,
    BoardInfo,
    BoardThread,
    BoardThreadDetail,
    BoardReply,
    BoardChannel,
    ChannelACLInfo,
} from "./types"

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
    const channelPattern = /- \[#([^\]]+)\]\([^)]+\)\s*(📢|🔒|🔊|🎥)?\s*\((\d+)\s*threads?\)/gu
    const channels: BoardChannel[] = []
    let match
    while ((match = channelPattern.exec(raw)) !== null) {
        const typeIndicator = match[2] || ""
        let type: ChannelType = "text"
        if (typeIndicator === "📢") type = "announcements"
        else if (typeIndicator === "🔒") type = "readonly"
        else if (typeIndicator === "🔊") type = "voice"
        else if (typeIndicator === "🎥") type = "video"
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

/** BoardParser V1 implementation — groups all parse functions under the strategy interface. */
export const boardParserV1: BoardParser = {
    version: "v1",
    parseBoardHome,
    parseThreadList,
    parseThreadDetail,
    parseACL,
    parseMentions,
}
