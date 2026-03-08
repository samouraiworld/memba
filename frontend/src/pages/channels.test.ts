/**
 * Unit tests for ChannelsPage helpers (v2.5a).
 *
 * Tests the exported helper functions: channelIcon, defaultChannel.
 */
import { describe, it, expect } from "vitest"
import { channelIcon, defaultChannel } from "./channelHelpers"
import type { BoardChannel } from "../plugins/board/parser"

// ── channelIcon ───────────────────────────────────────────────

describe("channelIcon", () => {
    it("returns 📢 for announcements channel", () => {
        const ch: BoardChannel = { name: "announcements", threadCount: 2, type: "announcements", archived: false }
        expect(channelIcon(ch)).toBe("📢")
    })

    it("returns 🔒 for readonly channel", () => {
        const ch: BoardChannel = { name: "rules", threadCount: 1, type: "readonly", archived: false }
        expect(channelIcon(ch)).toBe("🔒")
    })

    it("returns 💬 for text channel", () => {
        const ch: BoardChannel = { name: "general", threadCount: 5, type: "text", archived: false }
        expect(channelIcon(ch)).toBe("💬")
    })

    it("returns 💬 for unknown type (defaults to text)", () => {
        const ch: BoardChannel = { name: "custom", threadCount: 0, type: "text", archived: false }
        expect(channelIcon(ch)).toBe("💬")
    })
})

// ── defaultChannel ────────────────────────────────────────────

describe("defaultChannel", () => {
    const channels: BoardChannel[] = [
        { name: "general", threadCount: 3, type: "text", archived: false },
        { name: "dev", threadCount: 0, type: "text", archived: false },
        { name: "old", threadCount: 1, type: "text", archived: true },
    ]

    it("returns first non-archived channel", () => {
        expect(defaultChannel(channels)).toBe("general")
    })

    it("skips archived channels", () => {
        const archivedFirst: BoardChannel[] = [
            { name: "old", threadCount: 1, type: "text", archived: true },
            { name: "new", threadCount: 0, type: "text", archived: false },
        ]
        expect(defaultChannel(archivedFirst)).toBe("new")
    })

    it("returns 'general' when all channels are archived", () => {
        const allArchived: BoardChannel[] = [
            { name: "old", threadCount: 1, type: "text", archived: true },
        ]
        expect(defaultChannel(allArchived)).toBe("general")
    })

    it("returns 'general' for empty channel list", () => {
        expect(defaultChannel([])).toBe("general")
    })

    it("works with single active channel", () => {
        const single: BoardChannel[] = [
            { name: "announcements", threadCount: 2, type: "announcements", archived: false },
        ]
        expect(defaultChannel(single)).toBe("announcements")
    })
})
