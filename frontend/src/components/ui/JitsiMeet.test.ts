/**
 * Unit tests for JitsiMeet component helpers (v2.5c).
 *
 * Tests the exported jitsiRoomName function.
 */
import { describe, it, expect } from "vitest"
import { jitsiRoomName } from "./jitsiHelpers"

describe("jitsiRoomName", () => {
    it("creates a prefixed room name from slug and channel", () => {
        expect(jitsiRoomName("my-dao", "voice-chat")).toBe("memba-my-dao-voice-chat")
    })

    it("sanitizes special characters to hyphens", () => {
        expect(jitsiRoomName("dao/with/slashes", "general")).toBe("memba-dao-with-slashes-general")
    })

    it("handles encoded slug with underscores", () => {
        expect(jitsiRoomName("gno_land_r_demo", "video")).toBe("memba-gno_land_r_demo-video")
    })

    it("produces lowercase output", () => {
        expect(jitsiRoomName("MyDAO", "VoiceRoom")).toBe("memba-mydao-voiceroom")
    })

    it("produces a non-empty string", () => {
        const name = jitsiRoomName("x", "y")
        expect(name.length).toBeGreaterThan(0)
    })
})
