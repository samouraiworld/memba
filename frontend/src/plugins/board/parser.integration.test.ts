/**
 * Board parser integration tests — validates parser against representative
 * Render() output samples from test12.
 *
 * Tests the V1 parser directly AND via the strategy pattern to ensure
 * getActiveBoardParser() returns a working parser.
 *
 * @format-dependent — Update samples when boards2 hub (gno#5037) merges.
 */
import { describe, it, expect } from "vitest"
import { getActiveBoardParser, parseBoardHome, parseThreadList, parseThreadDetail, parseACL, parseMentions } from "./parser"
import { boardParserV1 } from "./parserV1"
import type { BoardParser } from "./types"

// ── Strategy pattern tests ───────────────────────────────────────

describe("getActiveBoardParser", () => {
    it("returns a valid BoardParser instance", () => {
        const parser = getActiveBoardParser()
        expect(parser.version).toBeDefined()
        expect(typeof parser.parseBoardHome).toBe("function")
        expect(typeof parser.parseThreadList).toBe("function")
        expect(typeof parser.parseThreadDetail).toBe("function")
        expect(typeof parser.parseACL).toBe("function")
        expect(typeof parser.parseMentions).toBe("function")
    })

    it("currently returns V1 parser", () => {
        const parser = getActiveBoardParser()
        expect(parser.version).toBe("v1")
    })

    it("V1 parser satisfies BoardParser interface", () => {
        const parser: BoardParser = boardParserV1
        expect(parser.version).toBe("v1")
    })
})

// ── Re-exported functions match V1 parser ────────────────────────

describe("re-exported parse functions match V1", () => {
    const sampleBoard = `# Test Board\n\nDescription\n\n## Channels\n\n- [#general](:general) (2 threads)`
    const sampleThreads = `# #general\n\n### [Hello](:general/0)\nby g1abc... | 1 replies | block 100`
    const sampleACL = "read:admin\nwrite:admin,member\ntype:text"

    it("parseBoardHome re-export matches V1", () => {
        const fromExport = parseBoardHome(sampleBoard)
        const fromV1 = boardParserV1.parseBoardHome(sampleBoard)
        expect(fromExport).toEqual(fromV1)
    })

    it("parseThreadList re-export matches V1", () => {
        const fromExport = parseThreadList(sampleThreads, "general")
        const fromV1 = boardParserV1.parseThreadList(sampleThreads, "general")
        expect(fromExport).toEqual(fromV1)
    })

    it("parseACL re-export matches V1", () => {
        const fromExport = parseACL(sampleACL)
        const fromV1 = boardParserV1.parseACL(sampleACL)
        expect(fromExport).toEqual(fromV1)
    })

    it("parseMentions re-export matches V1", () => {
        const addr = "g1" + "a".repeat(38)
        const fromExport = parseMentions(`@${addr}`)
        const fromV1 = boardParserV1.parseMentions(`@${addr}`)
        expect(fromExport).toEqual(fromV1)
    })
})

// ── Full board home — mixed channel types ────────────────────────

const FULL_BOARD_HOME = `# SamouraiDAO Channels

Official discussion channels for the Samourai.world DAO

## Channels

- [#general](:_channel/general) (12 threads)
- [#announcements](:_channel/announcements) 📢 (5 threads)
- [#dev](:_channel/dev) (28 threads)
- [#governance](:_channel/governance) (3 threads)
- [#readonly-docs](:_channel/readonly-docs) 🔒 (1 thread)
- [#voice-chat](:_channel/voice-chat) 🔊 (0 threads)
- [#video-calls](:_channel/video-calls) 🎥 (2 threads)
`

describe("Full board home with all channel types", () => {
    it("parses board name", () => {
        const info = parseBoardHome(FULL_BOARD_HOME)
        expect(info.name).toBe("SamouraiDAO Channels")
    })

    it("parses description between title and ## Channels", () => {
        const info = parseBoardHome(FULL_BOARD_HOME)
        expect(info.description).toContain("Official discussion channels")
    })

    it("parses all 7 channels", () => {
        const info = parseBoardHome(FULL_BOARD_HOME)
        expect(info.channels).toHaveLength(7)
    })

    it("correctly assigns channel types", () => {
        const info = parseBoardHome(FULL_BOARD_HOME)
        const types = info.channels.map(c => c.type)
        expect(types).toEqual(["text", "announcements", "text", "text", "readonly", "voice", "video"])
    })

    it("parses thread counts including zero", () => {
        const info = parseBoardHome(FULL_BOARD_HOME)
        expect(info.channels[0].threadCount).toBe(12)
        expect(info.channels[5].threadCount).toBe(0)
    })
})

// ── Thread list with various meta formats ────────────────────────

const THREAD_LIST_VARIED = `# #dev

### [Fix crossing bug in token factory](:dev/0)
by g1creator12345... | 5 replies | block 98000

### [RFC: New proposal category system](:dev/1)
by g1member123456... | 12 replies | block 98500

### [Deploy channels v2.1a](:dev/2)
by g1admin1234567... | 0 replies | block 99000
`

describe("Thread list with varied metadata", () => {
    it("parses all 3 threads", () => {
        const threads = parseThreadList(THREAD_LIST_VARIED, "dev")
        expect(threads).toHaveLength(3)
    })

    it("preserves thread titles with special chars", () => {
        const threads = parseThreadList(THREAD_LIST_VARIED, "dev")
        expect(threads[0].title).toBe("Fix crossing bug in token factory")
        expect(threads[1].title).toBe("RFC: New proposal category system")
    })

    it("parses zero reply count", () => {
        const threads = parseThreadList(THREAD_LIST_VARIED, "dev")
        expect(threads[2].replyCount).toBe(0)
    })

    it("assigns correct channel from argument", () => {
        const threads = parseThreadList(THREAD_LIST_VARIED, "dev")
        for (const t of threads) {
            expect(t.channel).toBe("dev")
        }
    })
})

// ── Thread detail with edit markers and replies ──────────────────

const THREAD_WITH_EDITS = `# Updated: Token Factory Design

This is the revised design document for the token factory.

It includes:
- GRC20 support
- 2.5% platform fee
- Crossing-compatible deploy

---
*Posted by g1creator12345678901234567890abcdef at block 95000* *(edited at block 95500)*

## Replies (3)

**g1reply1234567...** (block 95100)

Looks good! Ship it.

---

**g1reply2345678...** (block 95200) *(edited)*

I have concerns about the fee structure.

---

**g1reply3456789...** (block 95300)

+1 to this proposal.

---`

describe("Thread detail with edit markers", () => {
    it("detects edited thread", () => {
        const detail = parseThreadDetail(THREAD_WITH_EDITS, "dev", 5)
        expect(detail.edited).toBe(true)
        expect(detail.editedAt).toBe(95500)
    })

    it("parses full author address", () => {
        const detail = parseThreadDetail(THREAD_WITH_EDITS, "dev", 5)
        expect(detail.author).toBe("g1creator12345678901234567890abcdef")
    })

    it("parses all 3 replies", () => {
        const detail = parseThreadDetail(THREAD_WITH_EDITS, "dev", 5)
        expect(detail.replies).toHaveLength(3)
    })

    it("detects edited reply", () => {
        const detail = parseThreadDetail(THREAD_WITH_EDITS, "dev", 5)
        expect(detail.replies[0].edited).toBe(false)
        expect(detail.replies[1].edited).toBe(true)
        expect(detail.replies[2].edited).toBe(false)
    })

    it("parses multiline body content", () => {
        const detail = parseThreadDetail(THREAD_WITH_EDITS, "dev", 5)
        expect(detail.body).toContain("GRC20 support")
        expect(detail.body).toContain("Crossing-compatible deploy")
    })
})

// ── ACL edge cases ───────────────────────────────────────────────

describe("ACL parsing edge cases", () => {
    it("handles many roles", () => {
        const acl = parseACL("read:admin,dev,ops,finance,member\nwrite:admin,dev\ntype:text")
        expect(acl.readRoles).toHaveLength(5)
        expect(acl.writeRoles).toHaveLength(2)
    })

    it("handles announcements type", () => {
        const acl = parseACL("read:admin,member\nwrite:admin\ntype:announcements")
        expect(acl.type).toBe("announcements")
    })

    it("handles readonly type", () => {
        const acl = parseACL("read:admin\nwrite:\ntype:readonly")
        expect(acl.type).toBe("readonly")
        expect(acl.writeRoles).toEqual([])
    })
})

// ── Mentions with edge cases ─────────────────────────────────────

describe("Mentions parsing edge cases", () => {
    const validAddr = "g1" + "abcdef1234567890".repeat(2) + "abcdef"

    it("extracts mentions from inline text", () => {
        const mentions = parseMentions(`Hey @${validAddr}, please review this.`)
        expect(mentions).toHaveLength(1)
    })

    it("ignores addresses without @ prefix", () => {
        const mentions = parseMentions(`Address ${validAddr} is not a mention`)
        expect(mentions).toEqual([])
    })

    it("handles mentions at start of line", () => {
        const mentions = parseMentions(`@${validAddr} check this`)
        expect(mentions).toHaveLength(1)
    })
})
