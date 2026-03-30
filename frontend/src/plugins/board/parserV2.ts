/**
 * Board Parser V2 — placeholder for boards2 hub format (gno#5037).
 *
 * This parser will handle the new Render() output format when the boards2
 * safe functions + hub sub-realm PR merges upstream. Until then, this is
 * a skeleton that delegates to V1.
 *
 * Expected changes in boards2 hub:
 * - Board listing may come from `gno.land/r/gnoland/boards2/v1/hub`
 * - Read-only safe functions replace direct Render() for some queries
 * - Thread/reply format may include additional metadata fields
 *
 * Tracking: https://github.com/gnolang/gno/pull/5037
 *
 * @module plugins/board/parserV2
 */

import type { BoardParser, BoardInfo, BoardThread, BoardThreadDetail, ChannelACLInfo } from "./types"
import { boardParserV1 } from "./parserV1"

/**
 * BoardParser V2 — delegates to V1 until boards2 format is finalized.
 *
 * When gno#5037 merges and we know the new format:
 * 1. Implement the new regex/JSON parsers in this file
 * 2. Update `getActiveBoardParser()` in parser.ts to detect and return V2
 * 3. Add integration tests for V2 format samples
 */
export const boardParserV2: BoardParser = {
    version: "v2",

    parseBoardHome(raw: string): BoardInfo {
        // TODO(gno#5037): Implement boards2 hub format parsing.
        // Expected: hub may serve JSON or a different Markdown structure.
        return boardParserV1.parseBoardHome(raw)
    },

    parseThreadList(raw: string, channel: string): BoardThread[] {
        // TODO(gno#5037): Hub may change thread listing format.
        return boardParserV1.parseThreadList(raw, channel)
    },

    parseThreadDetail(raw: string, channel: string, threadId: number): BoardThreadDetail {
        // TODO(gno#5037): Thread detail may include new metadata fields.
        return boardParserV1.parseThreadDetail(raw, channel, threadId)
    },

    parseACL(raw: string): ChannelACLInfo {
        return boardParserV1.parseACL(raw)
    },

    parseMentions(body: string): string[] {
        return boardParserV1.parseMentions(body)
    },
}
