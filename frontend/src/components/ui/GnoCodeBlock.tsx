/**
 * GnoCodeBlock — React component for Gno/Go syntax highlighted code preview.
 * Pure tokenizer logic lives in lib/gnoTokenizer.ts (testable, lint-compliant).
 */
import { tokenize, TOKEN_COLORS } from "../../lib/gnoTokenizer"

interface GnoCodeBlockProps {
    code: string
    maxHeight?: number
}

export function GnoCodeBlock({ code, maxHeight = 500 }: GnoCodeBlockProps) {
    const tokens = tokenize(code)

    return (
        <pre style={{
            background: "#1e1e2e",
            border: "1px solid #333",
            borderRadius: 8,
            padding: "16px 20px",
            fontSize: 11,
            lineHeight: 1.6,
            fontFamily: "JetBrains Mono, Fira Code, monospace",
            color: TOKEN_COLORS.plain,
            overflowX: "auto",
            overflowY: "auto",
            maxHeight,
            margin: 0,
            whiteSpace: "pre",
            tabSize: 4,
        }}>
            <code>
                {tokens.map((token, i) => (
                    <span key={i} style={{ color: TOKEN_COLORS[token.type] }}>
                        {token.text}
                    </span>
                ))}
            </code>
        </pre>
    )
}
