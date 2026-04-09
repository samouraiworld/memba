/**
 * Pure Gno/Go tokenizer — no external dependencies.
 * Uses regex-based tokenization for syntax highlighting.
 *
 * Exported separately from the React component to comply with
 * react-refresh/only-export-components and enable unit testing.
 */

const KEYWORD_RE = /\b(package|import|func|var|const|type|struct|interface|if|else|for|range|return|defer|go|select|switch|case|default|break|continue|fallthrough|goto|chan|map|make|new|append|len|cap|nil|true|false|iota|panic|recover|print|println|delete|close|copy|real|imag|complex)\b/g
const TYPE_RE = /\b(string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|bool|byte|rune|error|any|address|realm|bigint)\b/g
const CUSTOM_TYPE_RE = /\b([A-Z][a-zA-Z0-9_]*)\b/g
const NUMBER_RE = /\b(\d+(?:\.\d+)?)\b/g
const STRING_RE = /"(?:[^"\\]|\\.)*"|`[^`]*`/g
const COMMENT_RE = /\/\/.*$/gm

export interface GnoToken {
    type: "keyword" | "type" | "customType" | "string" | "comment" | "number" | "plain"
    text: string
}

export const TOKEN_COLORS: Record<GnoToken["type"], string> = {
    keyword: "#56b6c2",      // cyan
    type: "#c678dd",         // purple
    customType: "#e5c07b",   // gold
    string: "#e5c07b",       // amber
    comment: "#5c6370",      // grey
    number: "#98c379",       // green
    plain: "#abb2bf",        // light grey
}

export function tokenize(code: string): GnoToken[] {
    const tokens: GnoToken[] = []
    const matches: { start: number; end: number; type: GnoToken["type"]; text: string }[] = []

    const addMatches = (re: RegExp, type: GnoToken["type"]) => {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(code)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] })
        }
    }

    // Priority order: comments > strings > keywords > types > custom types > numbers
    addMatches(COMMENT_RE, "comment")
    addMatches(STRING_RE, "string")
    addMatches(KEYWORD_RE, "keyword")
    addMatches(TYPE_RE, "type")
    addMatches(CUSTOM_TYPE_RE, "customType")
    addMatches(NUMBER_RE, "number")

    const priority: Record<GnoToken["type"], number> = {
        comment: 0, string: 1, keyword: 2, type: 3, customType: 4, number: 5, plain: 6,
    }
    matches.sort((a, b) => a.start - b.start || priority[a.type] - priority[b.type])

    // Resolve overlaps: earlier + higher priority wins
    let pos = 0
    const used = new Set<number>()
    for (const m of matches) {
        let overlaps = false
        for (let i = m.start; i < m.end; i++) {
            if (used.has(i)) { overlaps = true; break }
        }
        if (overlaps) continue

        if (m.start > pos) {
            tokens.push({ type: "plain", text: code.slice(pos, m.start) })
        }
        tokens.push({ type: m.type, text: m.text })
        for (let i = m.start; i < m.end; i++) used.add(i)
        pos = m.end
    }

    if (pos < code.length) {
        tokens.push({ type: "plain", text: code.slice(pos) })
    }

    return tokens
}
