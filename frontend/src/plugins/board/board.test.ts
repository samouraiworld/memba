/**
 * Unit tests for board/channel ABCI parser.
 *
 * @format-dependent — These tests rely on the exact Render() output format
 * from the board/channel realm. If the Gno template changes its Render output,
 * these tests must be updated accordingly.
 *
 * v2.1a: Added tests for channel types, ACL parsing, @mentions,
 * edit detection, and backward-compat with v1 _board format.
 */
import { describe, it, expect } from "vitest"
import { parseBoardHome, parseThreadList, parseThreadDetail, parseACL, parseMentions } from "./parser"

// ── parseBoardHome (v1 format — backward compat) ─────────────

describe("parseBoardHome (v1 format)", () => {
    const raw = `# MyDAO Board

Discussion board for MyDAO

## Channels

- [#general](:general) (3 threads)
- [#dev](:dev) (0 threads)
- [#governance](:governance) (1 thread)`

    it("parses board name from heading", () => {
        const info = parseBoardHome(raw)
        expect(info.name).toBe("MyDAO Board")
    })

    it("parses description text", () => {
        const info = parseBoardHome(raw)
        expect(info.description).toContain("Discussion board")
    })

    it("parses all channels with thread counts", () => {
        const info = parseBoardHome(raw)
        expect(info.channels).toHaveLength(3)
        expect(info.channels[0]).toEqual({ name: "general", threadCount: 3, type: "text", archived: false })
        expect(info.channels[1]).toEqual({ name: "dev", threadCount: 0, type: "text", archived: false })
        expect(info.channels[2]).toEqual({ name: "governance", threadCount: 1, type: "text", archived: false })
    })

    it("handles singular thread count", () => {
        const info = parseBoardHome(raw)
        expect(info.channels[2].threadCount).toBe(1)
    })

    it("returns empty channels for invalid format", () => {
        const info = parseBoardHome("# Board\n\nJust text, no channels")
        expect(info.channels).toHaveLength(0)
    })
})

// ── parseBoardHome (v2.1a format — channel types) ─────────────

describe("parseBoardHome (v2.1a format)", () => {
    const raw = `# MyDAO Channels

Community channels for MyDAO

## Channels

- [#general](:_channel/general) (5 threads)
- [#announcements](:_channel/announcements) 📢 (2 threads)
- [#readonly](:_channel/readonly) 🔒 (0 threads)
- [#dev](:_channel/dev) (1 thread)`

    it("parses channel type from emoji indicator", () => {
        const info = parseBoardHome(raw)
        expect(info.channels[0].type).toBe("text")
        expect(info.channels[1].type).toBe("announcements")
        expect(info.channels[2].type).toBe("readonly")
        expect(info.channels[3].type).toBe("text")
    })

    it("sets archived to false for visible channels", () => {
        const info = parseBoardHome(raw)
        for (const ch of info.channels) {
            expect(ch.archived).toBe(false)
        }
    })

    it("parses thread counts with type indicators", () => {
        const info = parseBoardHome(raw)
        expect(info.channels[0].threadCount).toBe(5)
        expect(info.channels[1].threadCount).toBe(2)
    })
})

// ── parseThreadList ───────────────────────────────────────────

describe("parseThreadList", () => {
    const raw = `# #general

### [Hello World](:general/0)
by g1abc12345... | 2 replies | block 12345

### [Another Thread](:general/1)
by g1def67890... | 0 replies | block 12350`

    it("parses all threads", () => {
        const threads = parseThreadList(raw, "general")
        expect(threads).toHaveLength(2)
    })

    it("parses thread title and ID", () => {
        const threads = parseThreadList(raw, "general")
        expect(threads[0].title).toBe("Hello World")
        expect(threads[0].id).toBe(0)
        expect(threads[1].title).toBe("Another Thread")
        expect(threads[1].id).toBe(1)
    })

    it("parses author from meta line", () => {
        const threads = parseThreadList(raw, "general")
        expect(threads[0].author).toBe("g1abc12345...")
    })

    it("parses reply count", () => {
        const threads = parseThreadList(raw, "general")
        expect(threads[0].replyCount).toBe(2)
        expect(threads[1].replyCount).toBe(0)
    })

    it("parses block height", () => {
        const threads = parseThreadList(raw, "general")
        expect(threads[0].blockHeight).toBe(12345)
    })

    it("returns empty array for empty channel", () => {
        const threads = parseThreadList("# #dev\n\n*No threads yet.*", "dev")
        expect(threads).toHaveLength(0)
    })
})

// ── parseThreadDetail ─────────────────────────────────────────

describe("parseThreadDetail", () => {
    const raw = `# Hello World

This is the thread body with **Markdown** support.

It has multiple paragraphs.

---
*Posted by g1fulladdress12345678901234567890 at block 12345*

## Replies (2)

**g1abc12345...** (block 12350)

Great post! I totally agree.

---

**g1def67890...** (block 12360)

Thanks for sharing.

---`

    it("parses thread title", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.title).toBe("Hello World")
    })

    it("parses thread body as Markdown", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.body).toContain("**Markdown**")
        expect(detail.body).toContain("multiple paragraphs")
    })

    it("parses full author address", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.author).toBe("g1fulladdress12345678901234567890")
    })

    it("parses block height", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.blockHeight).toBe(12345)
    })

    it("parses replies", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.replies).toHaveLength(2)
        expect(detail.replies[0].author).toBe("g1abc12345...")
        expect(detail.replies[0].blockHeight).toBe(12350)
        expect(detail.replies[0].body).toBe("Great post! I totally agree.")
        expect(detail.replies[1].body).toBe("Thanks for sharing.")
    })

    it("handles thread with no replies", () => {
        const noReplies = `# Only Title

Body text

---
*Posted by g1addr at block 100*`
        const detail = parseThreadDetail(noReplies, "general", 0)
        expect(detail.replies).toHaveLength(0)
    })

    it("preserves channel and threadId from arguments", () => {
        const detail = parseThreadDetail(raw, "dev", 42)
        expect(detail.channel).toBe("dev")
        expect(detail.id).toBe(42)
    })

    // v2.1a: edit detection
    it("detects unedited thread", () => {
        const detail = parseThreadDetail(raw, "general", 0)
        expect(detail.edited).toBe(false)
        expect(detail.editedAt).toBe(0)
    })

    it("detects edited thread", () => {
        const edited = `# Edited Post

Updated body

---
*Posted by g1addr12345678901234567890123456 at block 100* *(edited at block 110)*`
        const detail = parseThreadDetail(edited, "general", 0)
        expect(detail.edited).toBe(true)
        expect(detail.editedAt).toBe(110)
    })

    // v2.1a: reply edit detection
    it("detects edited reply", () => {
        const withEditedReply = `# Post

Body

---
*Posted by g1addr12345678901234567890123456 at block 100*

## Replies (1)

**g1abc12345...** (block 120) *(edited)*

Edited reply body

---`
        const detail = parseThreadDetail(withEditedReply, "general", 0)
        expect(detail.replies).toHaveLength(1)
        expect(detail.replies[0].edited).toBe(true)
    })
})

// ── parseACL (v2.1a) ──────────────────────────────────────────

describe("parseACL", () => {
    it("parses read and write roles", () => {
        const acl = parseACL("read:admin,dev\nwrite:admin,dev,member\ntype:text")
        expect(acl.readRoles).toEqual(["admin", "dev"])
        expect(acl.writeRoles).toEqual(["admin", "dev", "member"])
    })

    it("parses channel type", () => {
        const acl = parseACL("read:\nwrite:admin\ntype:announcements")
        expect(acl.type).toBe("announcements")
    })

    it("handles empty roles", () => {
        const acl = parseACL("read:\nwrite:\ntype:text")
        expect(acl.readRoles).toEqual([])
        expect(acl.writeRoles).toEqual([])
    })

    it("defaults to text type when missing", () => {
        const acl = parseACL("read:\nwrite:")
        expect(acl.type).toBe("text")
    })
})

// ── parseMentions (v2.1a) ─────────────────────────────────────

describe("parseMentions", () => {
    // Valid gno address: g1 + 38 lowercase alphanum = 40 chars total
    const addr1 = "g1" + "a".repeat(38) // g1aaaaa...a (40 chars)
    const addr2 = "g1" + "b".repeat(38)

    it("extracts @g1 addresses from body", () => {
        const mentions = parseMentions(`Hey @${addr1} check this out`)
        expect(mentions).toHaveLength(1)
        expect(mentions[0]).toBe(addr1)
    })

    it("extracts multiple unique mentions", () => {
        const mentions = parseMentions(`cc @${addr1} @${addr2}`)
        expect(mentions).toHaveLength(2)
    })

    it("deduplicates repeated mentions", () => {
        const mentions = parseMentions(`@${addr1} and again @${addr1}`)
        expect(mentions).toHaveLength(1)
    })

    it("returns empty for no mentions", () => {
        const mentions = parseMentions("No mentions here, just regular text")
        expect(mentions).toEqual([])
    })

    it("ignores invalid short addresses", () => {
        const mentions = parseMentions("@g1short is not valid")
        expect(mentions).toEqual([])
    })
})
