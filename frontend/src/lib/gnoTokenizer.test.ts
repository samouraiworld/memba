/**
 * gnoTokenizer.test.ts — Unit tests for the Gno/Go syntax tokenizer.
 *
 * Covers: keywords, types, strings, comments, numbers, custom types,
 * Gno-specific types (address, realm), and edge cases.
 */

import { describe, it, expect } from "vitest"
import { tokenize, TOKEN_COLORS, type GnoToken } from "./gnoTokenizer"

describe("gnoTokenizer — keywords", () => {
    it("tokenizes Go keywords", () => {
        const tokens = tokenize("func main() { return }")
        expect(tokens.some(t => t.type === "keyword" && t.text === "func")).toBe(true)
        expect(tokens.some(t => t.type === "keyword" && t.text === "return")).toBe(true)
    })

    it("tokenizes fallthrough and goto", () => {
        const tokens = tokenize("switch x { case 1: fallthrough; default: goto end }")
        expect(tokens.some(t => t.type === "keyword" && t.text === "fallthrough")).toBe(true)
        expect(tokens.some(t => t.type === "keyword" && t.text === "goto")).toBe(true)
    })

    it("tokenizes Gno builtins (panic, recover, println)", () => {
        const tokens = tokenize("panic(\"error\")")
        expect(tokens.some(t => t.type === "keyword" && t.text === "panic")).toBe(true)
    })

    it("tokenizes all control flow keywords", () => {
        const keywords = ["if", "else", "for", "range", "switch", "case", "default", "break", "continue", "select", "defer", "go"]
        for (const kw of keywords) {
            const tokens = tokenize(kw + " ")
            expect(tokens.some(t => t.type === "keyword" && t.text === kw)).toBe(true)
        }
    })
})

describe("gnoTokenizer — types", () => {
    it("tokenizes Go primitive types", () => {
        const types = ["string", "int", "int64", "uint64", "bool", "byte", "float64", "error"]
        for (const typ of types) {
            const tokens = tokenize("var x " + typ)
            expect(tokens.some(t => t.type === "type" && t.text === typ)).toBe(true)
        }
    })

    it("tokenizes Gno-specific types (address, realm, bigint)", () => {
        const tokens = tokenize("func Transfer(cur realm, to address, amount bigint)")
        expect(tokens.some(t => t.type === "type" && t.text === "realm")).toBe(true)
        expect(tokens.some(t => t.type === "type" && t.text === "address")).toBe(true)
        expect(tokens.some(t => t.type === "type" && t.text === "bigint")).toBe(true)
    })

    it("tokenizes custom types (PascalCase)", () => {
        const tokens = tokenize("type MyStruct struct {}")
        expect(tokens.some(t => t.type === "customType" && t.text === "MyStruct")).toBe(true)
    })
})

describe("gnoTokenizer — strings", () => {
    it("tokenizes double-quoted strings", () => {
        const tokens = tokenize('name := "hello"')
        expect(tokens.some(t => t.type === "string" && t.text === '"hello"')).toBe(true)
    })

    it("tokenizes backtick raw strings", () => {
        const tokens = tokenize("path := `gno.land/r/demo`")
        expect(tokens.some(t => t.type === "string" && t.text === "`gno.land/r/demo`")).toBe(true)
    })

    it("handles escaped quotes in strings", () => {
        const tokens = tokenize('msg := "say \\"hello\\""')
        expect(tokens.some(t => t.type === "string")).toBe(true)
    })
})

describe("gnoTokenizer — comments", () => {
    it("tokenizes single-line comments", () => {
        const tokens = tokenize("x := 1 // counter")
        expect(tokens.some(t => t.type === "comment" && t.text === "// counter")).toBe(true)
    })

    it("comments take priority over keywords", () => {
        const tokens = tokenize("// func main() {}")
        // The entire line should be a comment, not a keyword
        expect(tokens[0].type).toBe("comment")
    })
})

describe("gnoTokenizer — numbers", () => {
    it("tokenizes integers", () => {
        const tokens = tokenize("x := 42")
        expect(tokens.some(t => t.type === "number" && t.text === "42")).toBe(true)
    })

    it("tokenizes floats", () => {
        const tokens = tokenize("pi := 3.14")
        expect(tokens.some(t => t.type === "number" && t.text === "3.14")).toBe(true)
    })
})

describe("gnoTokenizer — integration", () => {
    it("tokenizes a complete Gno function", () => {
        const code = `func Transfer(cur realm, to address, amount int64) {
    // Check balance
    if balance < amount {
        panic("insufficient funds")
    }
}`
        const tokens = tokenize(code)
        expect(tokens.some(t => t.type === "keyword" && t.text === "func")).toBe(true)
        expect(tokens.some(t => t.type === "type" && t.text === "realm")).toBe(true)
        expect(tokens.some(t => t.type === "type" && t.text === "address")).toBe(true)
        expect(tokens.some(t => t.type === "type" && t.text === "int64")).toBe(true)
        expect(tokens.some(t => t.type === "comment")).toBe(true)
        expect(tokens.some(t => t.type === "keyword" && t.text === "if")).toBe(true)
        expect(tokens.some(t => t.type === "keyword" && t.text === "panic")).toBe(true)
        expect(tokens.some(t => t.type === "string")).toBe(true)
    })

    it("preserves all original text when reassembled", () => {
        const code = "func main() { return 42 }"
        const tokens = tokenize(code)
        const reassembled = tokens.map(t => t.text).join("")
        expect(reassembled).toBe(code)
    })

    it("handles empty string", () => {
        const tokens = tokenize("")
        expect(tokens).toHaveLength(0)
    })
})

describe("TOKEN_COLORS", () => {
    it("has colors for all token types", () => {
        const types: GnoToken["type"][] = ["keyword", "type", "customType", "string", "comment", "number", "plain"]
        for (const t of types) {
            expect(TOKEN_COLORS[t]).toBeTruthy()
        }
    })
})
