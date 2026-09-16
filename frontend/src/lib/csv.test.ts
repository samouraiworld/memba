import { describe, expect, it } from "vitest"
import { csvCell } from "./csv"

describe("csvCell", () => {
    it.each([
        ["=HYPERLINK(\"http://example.invalid\",\"x\")"],
        ["=1+1"],
        ["+1+1"],
        ["-1+1"],
        ["@SUM(A1:A2)"],
        ["\t=1+1"],
        ["\r=1+1"],
    ])("neutralizes a formula-leading value %j with a single quote", (value) => {
        const cell = csvCell(value)
        expect(cell.startsWith("\"'")).toBe(true)
        expect(cell).toBe(`"'${value.replace(/"/g, "\"\"")}"`)
    })

    it("always wraps in double quotes and doubles embedded quotes", () => {
        expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"")
    })

    it("keeps commas and newlines inside the quoted cell", () => {
        expect(csvCell("a,b\nc")).toBe("\"a,b\nc\"")
    })

    it("escapes quotes after neutralizing", () => {
        expect(csvCell("=\"x\"")).toBe("\"'=\"\"x\"\"\"")
    })

    it.each([
        ["Fund the grant"],
        ["alice"],
        ["g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m"],
        ["a = b"],
        ["100%"],
        [""],
    ])("leaves benign value %j unchanged apart from quoting", (value) => {
        expect(csvCell(value)).toBe(`"${value}"`)
    })
})
