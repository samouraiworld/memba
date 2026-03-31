import { describe, it, expect } from "vitest"
import { formatGnot, formatGnotCompact, parseGnot } from "./formatGnot"

describe("formatGnot", () => {
    it("formats 1 GNOT", () => expect(formatGnot(1_000_000n)).toBe("1.00 GNOT"))
    it("formats 1.5 GNOT", () => expect(formatGnot(1_500_000n)).toBe("1.50 GNOT"))
    it("formats 0.5 GNOT", () => expect(formatGnot(500_000n)).toBe("0.50 GNOT"))
    it("formats 0 GNOT", () => expect(formatGnot(0n)).toBe("0.00 GNOT"))
    it("formats large amount", () => expect(formatGnot(10_000_000n)).toBe("10.00 GNOT"))
    it("accepts number input", () => expect(formatGnot(1_000_000)).toBe("1.00 GNOT"))
    it("custom decimals", () => expect(formatGnot(100n, 6)).toBe("0.000100 GNOT"))
})

describe("formatGnotCompact", () => {
    it("whole number", () => expect(formatGnotCompact(1_000_000n)).toBe("1 GNOT"))
    it("fractional", () => expect(formatGnotCompact(1_500_000n)).toBe("1.5 GNOT"))
    it("small fraction", () => expect(formatGnotCompact(100_000n)).toBe("0.1 GNOT"))
    it("zero", () => expect(formatGnotCompact(0n)).toBe("0 GNOT"))
})

describe("parseGnot", () => {
    it("parses 1.5", () => expect(parseGnot("1.5")).toBe(1_500_000n))
    it("parses 0.001", () => expect(parseGnot("0.001")).toBe(1_000n))
    it("parses with GNOT suffix", () => expect(parseGnot("2.5 GNOT")).toBe(2_500_000n))
    it("parses whole number", () => expect(parseGnot("10")).toBe(10_000_000n))
    it("returns null for invalid", () => expect(parseGnot("abc")).toBeNull())
    it("returns null for negative", () => expect(parseGnot("-1")).toBeNull())
    it("trims whitespace", () => expect(parseGnot("  1.0  ")).toBe(1_000_000n))
})
