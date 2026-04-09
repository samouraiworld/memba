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
import { tokenize, TOKEN_COLORS } from "../../lib/gnoTokenizer"
import type { GnoToken } from "../../lib/gnoTokenizer"

// ── Gno/Go Syntax Tokenizer (delegated to lib/gnoTokenizer) ─

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Map canonical token type to the CSS class used by the existing stylesheet. */
const TOKEN_TYPE_TO_CLASS: Record<GnoToken["type"], string | null> = {
    keyword: "gno-keyword",
    type: "gno-type",
    customType: "gno-func",   // exported/custom types use the func highlight
    string: "gno-string",
    comment: "gno-comment",
    number: "gno-number",
    plain: null,
}

/** Tokenize a single line of Gno source code into HTML with syntax classes. */
function tokenizeLine(line: string): string {
    const tokens = tokenize(line)
    return tokens.map(t => {
        const cls = TOKEN_TYPE_TO_CLASS[t.type]
        const escaped = escapeHtml(t.text)
        return cls ? `<span class="${cls}">${escaped}</span>` : escaped
    }).join("")
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
