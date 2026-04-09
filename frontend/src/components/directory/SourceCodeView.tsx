/**
 * SourceCodeView — Syntax-highlighted Gno source code viewer.
 *
 * Features:
 * - File tabs (when multiple files)
 * - Line numbers in fixed-width gutter
 * - CSS-only Gno/Go syntax highlighting via regex tokenizer
 * - Copy file source to clipboard
 * - Max height 500px with scroll
 *
 * @module components/directory/SourceCodeView
 */

import { useState, useMemo, useCallback } from "react"
import DOMPurify from "dompurify"

import type { SourceFile } from "../../lib/gnowebSource"

// ── Gno/Go Syntax Tokenizer ────────────────────────────────

const GNO_KEYWORDS = new Set([
    "func", "import", "package", "var", "const", "type", "struct", "interface",
    "if", "else", "for", "range", "return", "switch", "case", "default",
    "defer", "go", "select", "chan", "map", "break", "continue", "fallthrough",
    "goto", "nil", "true", "false", "iota",
])

const GNO_TYPES = new Set([
    "string", "int", "int8", "int16", "int32", "int64",
    "uint", "uint8", "uint16", "uint32", "uint64",
    "float32", "float64", "bool", "byte", "rune", "error",
    "address", "realm", "std",
])

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Tokenize a single line of Gno source code into HTML with syntax classes. */
function tokenizeLine(line: string): string {
    // Process the line character by character for accurate tokenization
    let result = ""
    let i = 0

    while (i < line.length) {
        // Comment (rest of line)
        if (line[i] === "/" && line[i + 1] === "/") {
            result += `<span class="gno-comment">${escapeHtml(line.slice(i))}</span>`
            break
        }

        // String literal (double-quoted)
        if (line[i] === '"') {
            let j = i + 1
            while (j < line.length && line[j] !== '"') {
                if (line[j] === "\\") j++ // skip escaped char
                j++
            }
            j++ // include closing quote
            result += `<span class="gno-string">${escapeHtml(line.slice(i, j))}</span>`
            i = j
            continue
        }

        // Backtick string (raw string)
        if (line[i] === "`") {
            let j = i + 1
            while (j < line.length && line[j] !== "`") j++
            j++
            result += `<span class="gno-string">${escapeHtml(line.slice(i, j))}</span>`
            i = j
            continue
        }

        // Word (keyword, type, or identifier)
        if (/[a-zA-Z_]/.test(line[i])) {
            let j = i
            while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++
            const word = line.slice(i, j)
            if (GNO_KEYWORDS.has(word)) {
                result += `<span class="gno-keyword">${escapeHtml(word)}</span>`
            } else if (GNO_TYPES.has(word)) {
                result += `<span class="gno-type">${escapeHtml(word)}</span>`
            } else if (word[0] === word[0].toUpperCase() && word[0] !== "_" && /[a-z]/.test(word)) {
                // Exported name (starts with uppercase, has lowercase)
                result += `<span class="gno-func">${escapeHtml(word)}</span>`
            } else {
                result += escapeHtml(word)
            }
            i = j
            continue
        }

        // Number literal
        if (/[0-9]/.test(line[i])) {
            let j = i
            while (j < line.length && /[0-9.xXa-fA-F]/.test(line[j])) j++
            result += `<span class="gno-number">${escapeHtml(line.slice(i, j))}</span>`
            i = j
            continue
        }

        // Default: single character
        result += escapeHtml(line[i])
        i++
    }

    return result
}

// ── Component ───────────────────────────────────────────────

interface SourceCodeViewProps {
    files: SourceFile[]
    activeFile?: string
}

export function SourceCodeView({ files, activeFile: initialActive }: SourceCodeViewProps) {
    const [activeFile, setActiveFile] = useState(initialActive || files[0]?.name || "")
    const [copied, setCopied] = useState(false)

    const currentFile = files.find(f => f.name === activeFile) || files[0]

    const highlightedLines = useMemo(() => {
        if (!currentFile) return []
        return currentFile.content.split("\n").map(tokenizeLine)
    }, [currentFile])

    const handleCopy = useCallback(() => {
        if (!currentFile) return
        navigator.clipboard.writeText(currentFile.content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [currentFile])

    if (files.length === 0) {
        return <div className="source-empty">No source files available</div>
    }

    return (
        <div className="source-view">
            {/* File tabs */}
            {files.length > 1 && (
                <div className="source-tabs">
                    {files.map(f => (
                        <button
                            key={f.name}
                            className={`source-tab${f.name === activeFile ? " active" : ""}`}
                            onClick={() => setActiveFile(f.name)}
                        >
                            {f.name}
                            <span className="source-tab__lines">{f.lines}L</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Toolbar */}
            <div className="source-toolbar">
                <span className="source-toolbar__name">{currentFile?.name}</span>
                <button className="source-copy-btn" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy"}
                </button>
            </div>

            {/* Code area */}
            <div className="source-code-area">
                <div className="source-gutter">
                    {highlightedLines.map((_, i) => (
                        <span key={i} className="source-line-num">{i + 1}</span>
                    ))}
                </div>
                <pre className="source-code">
                    <code>
                        {highlightedLines.map((html, i) => (
                            <div
                                key={i}
                                className="source-line"
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html || "&nbsp;") }}
                            />
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    )
}
