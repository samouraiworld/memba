import { describe, expect, it } from "vitest"
import { formatDuration } from "./duration"

describe("formatDuration", () => {
    it.each([[0, "no wait"], [3600, "1 hour"], [86400, "1 day"], [3 * 86400, "3 days"], [24 * 3600, "1 day"], [5400, "90 minutes"], [61, "61 seconds"]])("%i -> %s", (s, want) => {
        expect(formatDuration(s)).toBe(want)
    })
})
