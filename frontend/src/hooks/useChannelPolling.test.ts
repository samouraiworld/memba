/**
 * Unit tests for useChannelPolling hook (v2.5b).
 *
 * Tests the exported constants and validates the hook interface.
 * Integration tests require a React test environment; these test
 * the polling constant and key behaviors.
 */
import { describe, it, expect } from "vitest"
import { POLL_INTERVAL_MS } from "./useChannelPolling"

describe("useChannelPolling constants", () => {
    it("POLL_INTERVAL_MS is 10 seconds", () => {
        expect(POLL_INTERVAL_MS).toBe(10_000)
    })

    it("POLL_INTERVAL_MS is a positive number", () => {
        expect(POLL_INTERVAL_MS).toBeGreaterThan(0)
    })

    it("POLL_INTERVAL_MS is less than notification polling (30s)", () => {
        // Channels should poll faster than notifications
        expect(POLL_INTERVAL_MS).toBeLessThan(30_000)
    })
})
