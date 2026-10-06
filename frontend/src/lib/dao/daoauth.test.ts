import { describe, expect, it } from "vitest"
import { parseArgs } from "./daoauth"

const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

describe("daoauth", () => {
    it("round-trips every tag", () => {
        const s = `u:0|u:18446744073709551615|i:-9223372036854775808|i:7|b:1|b:0|a:${ADDR}|s:0:|s:10:a|b:c d"\\\\`
        const fields = parseArgs(s)
        expect(fields.map(f => f.tag).join("")).toBe("uuiibbass")
        expect(fields[8].value).toBe('a|b:c d"\\\\')
        expect(parseArgs("")).toEqual([])
    })

    it("refuses every non-canonical spelling, as the realm does", () => {
        for (const bad of ["u:01", "u:-1", "u:18446744073709551616", "i:-0", "i:+1", "i:9223372036854775808", "b:2", "b:true",
            `a:${ADDR.toUpperCase()}`, `a:${ADDR.slice(0, -1)}q`, "s:2:a", "s:01:a", "s:1:é", "s:1:\n", "x:1", "u:1|", "|u:1", "u:1||u:2", "u",
            `s:513:${"a".repeat(513)}`, `s:512:${"a".repeat(512)}|s:512:${"a".repeat(512)}`]) {
            expect(() => parseArgs(bad), bad).toThrow()
        }
    })
})
