/**
 * Unit tests for Jitsi Meet helpers (v2.9).
 *
 * Tests jitsiRoomName (with hash suffix), shortHash, and jitsiIframeSrc.
 */
import { describe, it, expect } from "vitest"
import { jitsiRoomName, shortHash, jitsiIframeSrc, JAAS_APP_ID } from "./jitsiHelpers"

describe("shortHash", () => {
    it("produces a 5-char hex string", () => {
        const h = shortHash("test-input")
        expect(h).toMatch(/^[0-9a-f]{5}$/)
    })

    it("is deterministic", () => {
        expect(shortHash("foo")).toBe(shortHash("foo"))
    })

    it("produces different hashes for different inputs", () => {
        expect(shortHash("dao-a")).not.toBe(shortHash("dao-b"))
    })
})

describe("jitsiRoomName", () => {
    it("creates a prefixed room name with hash suffix", () => {
        const name = jitsiRoomName("my-dao", "voice-chat")
        expect(name).toMatch(/^memba-my-dao-voice-chat-[0-9a-f]{5}$/)
    })

    it("sanitizes special characters to hyphens", () => {
        const name = jitsiRoomName("dao/with/slashes", "general")
        expect(name).toMatch(/^memba-dao-with-slashes-general-[0-9a-f]{5}$/)
    })

    it("handles underscores without sanitizing them", () => {
        const name = jitsiRoomName("gno_land_r_demo", "video")
        expect(name).toMatch(/^memba-gno_land_r_demo-video-[0-9a-f]{5}$/)
    })

    it("produces lowercase output", () => {
        const name = jitsiRoomName("MyDAO", "VoiceRoom")
        expect(name).toMatch(/^memba-mydao-voiceroom-[0-9a-f]{5}$/)
    })

    it("is deterministic (same inputs → same room name)", () => {
        expect(jitsiRoomName("x", "y")).toBe(jitsiRoomName("x", "y"))
    })

    it("produces different room names for different DAOs", () => {
        expect(jitsiRoomName("dao-a", "general")).not.toBe(jitsiRoomName("dao-b", "general"))
    })
})

describe("jitsiIframeSrc", () => {
    it("builds a valid Jitsi URL with the correct domain", () => {
        const src = jitsiIframeSrc("test-room", "config=1")
        if (JAAS_APP_ID) {
            // JaaS mode: 8x8.vc with app ID prefix
            expect(src).toContain("8x8.vc")
            expect(src).toContain(JAAS_APP_ID)
            expect(src).toContain("test-room")
        } else {
            // Fallback: meet.jit.si
            expect(src).toContain("meet.jit.si/test-room")
        }
        expect(src).toContain("#config=1")
    })
})
