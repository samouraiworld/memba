/**
 * Unit tests for ChannelsPage helpers (v2.5a).
 *
 * Tests the exported helper functions: channelIcon, defaultChannel.
 */
import { describe, it, expect } from "vitest"
import { channelIcon, defaultChannel } from "./channelHelpers"
import type { BoardChannel } from "../plugins/board/parser"
import { parseBoardHome } from "../plugins/board/parser"

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

    it("returns 🔊 for voice channel (v2.5c)", () => {
        const ch: BoardChannel = { name: "voice", threadCount: 0, type: "voice", archived: false }
        expect(channelIcon(ch)).toBe("🔊")
    })

    it("returns 🎥 for video channel (v2.5c)", () => {
        const ch: BoardChannel = { name: "video", threadCount: 0, type: "video", archived: false }
        expect(channelIcon(ch)).toBe("🎥")
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

// ── parseBoardHome (v2.5c: voice/video indicators) ────────────

describe("parseBoardHome — v2.5c type indicators", () => {
    it("parses 🔊 as voice channel type", () => {
        const raw = `# Test Board

## Channels

- [#voice-chat](:_channel/voice-chat) 🔊 (0 threads)`
        const result = parseBoardHome(raw)
        expect(result.channels).toHaveLength(1)
        expect(result.channels[0].name).toBe("voice-chat")
        expect(result.channels[0].type).toBe("voice")
    })

    it("parses 🎥 as video channel type", () => {
        const raw = `# Test Board

## Channels

- [#video-room](:_channel/video-room) 🎥 (0 threads)`
        const result = parseBoardHome(raw)
        expect(result.channels).toHaveLength(1)
        expect(result.channels[0].name).toBe("video-room")
        expect(result.channels[0].type).toBe("video")
    })

    it("parses mixed channel types correctly", () => {
        const raw = `# DAO Channels

## Channels

- [#general](:_channel/general) (5 threads)
- [#news](:_channel/news) 📢 (2 threads)
- [#voice](:_channel/voice) 🔊 (0 threads)
- [#meeting](:_channel/meeting) 🎥 (0 threads)
- [#rules](:_channel/rules) 🔒 (1 thread)`
        const result = parseBoardHome(raw)
        expect(result.channels).toHaveLength(5)
        expect(result.channels[0].type).toBe("text")
        expect(result.channels[1].type).toBe("announcements")
        expect(result.channels[2].type).toBe("voice")
        expect(result.channels[3].type).toBe("video")
        expect(result.channels[4].type).toBe("readonly")
    })
})
