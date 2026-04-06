/**
 * markdownLite — Lightweight markdown-to-HTML renderer for Gno Render() output.
 *
 * Supports: headings, bold, italic, links, lists, code blocks, inline code,
 * tables, horizontal rules, bech32 address auto-linking.
 *
 * XSS-safe: all user content is escaped before HTML insertion.
 * Protocol whitelist: only https?, gno.land/, and relative paths.
 *
 * @module lib/markdownLite
 */

// ── HTML Escaping ───────────────────────────────────────────

const ESC_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
}

function escapeHtml(str: string): string {
    return str.replace(/[&<>"']/g, ch => ESC_MAP[ch])
}

// ── Protocol Whitelist ──────────────────────────────────────

/** Only allow safe URL protocols. Reject javascript:, data:, vbscript: etc. */
function sanitizeUrl(href: string): string {
    const trimmed = href.trim()
    // Allow relative paths, anchor links, gno.land paths
    if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("gno.land/")) {
        return escapeHtml(trimmed)
    }
    // Allow http/https
    if (/^https?:\/\//i.test(trimmed)) {
        return escapeHtml(trimmed)
    }
    // Block everything else
    return "#"
}

// ── Bech32 Address Pattern ──────────────────────────────────

const BECH32_PATTERN = /\bg1[a-z0-9]{38}\b/g

function autoLinkAddresses(text: string): string {
    return text.replace(BECH32_PATTERN, addr =>
        `<a href="/profile/${addr}" class="md-address">${addr}</a>`,
    )
}

// ── Inline Processing ───────────────────────────────────────

function processInline(text: string): string {
    let out = escapeHtml(text)

    // Inline code (must come before bold/italic to avoid conflicts)
    out = out.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

    // Bold + italic
    out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    out = out.replace(/\*(.+?)\*/g, "<em>$1</em>")

    // Links [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
        const safeHref = sanitizeUrl(href.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`
    })

    // Auto-link bech32 addresses
    out = autoLinkAddresses(out)

    return out
}

// ── Block Processing ────────────────────────────────────────

export function renderMarkdown(md: string): string {
    if (!md) return ""

    const lines = md.split("\n")
    const blocks: string[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]

        // Fenced code block
        if (line.startsWith("```")) {
            const lang = line.slice(3).trim()
            const codeLines: string[] = []
            i++
            while (i < lines.length && !lines[i].startsWith("```")) {
                codeLines.push(lines[i])
                i++
            }
            i++ // skip closing ```
            const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ""
            blocks.push(`<pre class="md-code-block"${langAttr}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`)
            continue
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
            blocks.push('<hr class="md-hr" />')
            i++
            continue
        }

        // Headings
        const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
        if (headingMatch) {
            const level = headingMatch[1].length
            blocks.push(`<h${level} class="md-h${level}">${processInline(headingMatch[2])}</h${level}>`)
            i++
            continue
        }

        // Table (detect by pipe-separated lines)
        if (line.includes("|") && line.trim().startsWith("|")) {
            const tableLines: string[] = []
            while (i < lines.length && lines[i].includes("|")) {
                tableLines.push(lines[i])
                i++
            }
            blocks.push(renderTable(tableLines))
            continue
        }

        // Unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const listItems: string[] = []
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                listItems.push(lines[i].replace(/^\s*[-*]\s+/, ""))
                i++
            }
            blocks.push(`<ul class="md-ul">${listItems.map(li => `<li>${processInline(li)}</li>`).join("")}</ul>`)
            continue
        }

        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
            const listItems: string[] = []
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ""))
                i++
            }
            blocks.push(`<ol class="md-ol">${listItems.map(li => `<li>${processInline(li)}</li>`).join("")}</ol>`)
            continue
        }

        // Empty line → skip
        if (line.trim() === "") {
            i++
            continue
        }

        // Paragraph (collect consecutive non-empty lines)
        const paraLines: string[] = []
        while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
            paraLines.push(lines[i])
            i++
        }
        if (paraLines.length > 0) {
            blocks.push(`<p class="md-p">${processInline(paraLines.join(" "))}</p>`)
        }
    }

    return blocks.join("\n")
}

// ── Table Renderer ──────────────────────────────────────────

function renderTable(lines: string[]): string {
    if (lines.length < 2) return `<p class="md-p">${processInline(lines[0])}</p>`

    const parseCells = (line: string) =>
        line.split("|").map(c => c.trim()).filter(c => c.length > 0)

    const headers = parseCells(lines[0])
    // Skip separator line (---|----|---)
    const startIdx = /^[\s|:-]+$/.test(lines[1]) ? 2 : 1

    let html = '<table class="md-table"><thead><tr>'
    for (const h of headers) {
        html += `<th>${processInline(h)}</th>`
    }
    html += "</tr></thead><tbody>"

    for (let j = startIdx; j < lines.length; j++) {
        const cells = parseCells(lines[j])
        html += "<tr>"
        for (const c of cells) {
            html += `<td>${processInline(c)}</td>`
        }
        html += "</tr>"
    }

    html += "</tbody></table>"
    return html
}
