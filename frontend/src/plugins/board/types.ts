/**
 * Board plugin types — shared between parser versions.
 *
 * Extracted from parser.ts to enable the V1/V2 strategy pattern
 * for boards2 hub migration (gno#5037).
 *
 * @module plugins/board/types
 */

import type { ChannelType } from "../../lib/channelTemplate"

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
    type: ChannelType    // "text" | "announcements" | "readonly"
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

/**
 * BoardParser interface — strategy pattern for Render() format parsing.
 *
 * V1: Current regex-based parser for boards/channels realm Render() output.
 * V2: Future parser for boards2 hub format (gno#5037) with safe functions.
 *
 * Each parser version implements the same interface, allowing the ABCI
 * query layer to swap parsers transparently when the upstream format changes.
 */
export interface BoardParser {
    readonly version: "v1" | "v2"

    parseBoardHome(raw: string): BoardInfo
    parseThreadList(raw: string, channel: string): BoardThread[]
    parseThreadDetail(raw: string, channel: string, threadId: number): BoardThreadDetail
    parseACL(raw: string): ChannelACLInfo
    parseMentions(body: string): string[]
}
