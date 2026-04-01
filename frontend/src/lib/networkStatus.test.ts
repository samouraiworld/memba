import { describe, it, expect } from "vitest"
import { formatBlockAge } from "./networkStatus"

describe("formatBlockAge", () => {
    it("formats seconds", () => expect(formatBlockAge(30)).toBe("30s ago"))
    it("formats minutes", () => expect(formatBlockAge(120)).toBe("2m ago"))
    it("formats hours", () => expect(formatBlockAge(7200)).toBe("2h ago"))
    it("formats days", () => expect(formatBlockAge(172800)).toBe("2d ago"))
    it("formats 0", () => expect(formatBlockAge(0)).toBe("0s ago"))
})
