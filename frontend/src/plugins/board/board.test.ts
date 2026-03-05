/**
 * Unit tests for board ABCI parser.
 */
import { describe, it, expect } from "vitest"
import { parseBoardHome, parseThreadList, parseThreadDetail } from "./parser"

// ── parseBoardHome ────────────────────────────────────────────

describe("parseBoardHome", () => {
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
        expect(info.channels[0]).toEqual({ name: "general", threadCount: 3 })
        expect(info.channels[1]).toEqual({ name: "dev", threadCount: 0 })
        expect(info.channels[2]).toEqual({ name: "governance", threadCount: 1 })
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
})
