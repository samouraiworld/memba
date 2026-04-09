/**
 * gnowebSource — Fetch and parse realm/package source code from gnoweb.
 *
 * Parses gnoweb $source and $help HTML pages to extract:
 * - .gno source files with content
 * - Exported function signatures
 * - Import paths (dependencies)
 *
 * Defensive parsing: gracefully falls back if gnoweb format changes.
 * SSRF guard: validates realm paths before constructing URLs.
 *
 * @module lib/gnowebSource
 */

// ── Types ────────────────────────────────────────────────────

export interface SourceFile {
    name: string      // "realm.gno"
    content: string   // Full source code
    lines: number     // Line count
}

export interface FunctionSignature {
    name: string       // "Render"
    params: string     // "(path string)"
    returns: string    // "string"
    isExported: boolean
}

export interface RealmSource {
    files: SourceFile[]
    functions: FunctionSignature[]
    imports: string[]
    gnoModContent?: string
}

// ── Validation ──────────────────────────────────────────────

const VALID_PATH_RE = /^\/[rp]\/[a-z0-9_\-/]+$/

/** Validate realm/package paths to prevent SSRF. */
export function isValidRealmPath(path: string): boolean {
    return VALID_PATH_RE.test(path)
}

// ── Caching ─────────────────────────────────────────────────

const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const CACHE_PREFIX = "memba_gnosrc_"
const MAX_CACHE_SIZE = 2 * 1024 * 1024 // 2MB total cap

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + key)
        if (!raw) return null
        const entry = JSON.parse(raw)
        if (typeof entry?.ts !== "number" || !("data" in entry)) return null
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(CACHE_PREFIX + key)
            return null
        }
        return entry.data as T
    } catch {
        return null
    }
}

function setCache<T>(key: string, data: T): void {
    try {
        const payload = JSON.stringify({ data, ts: Date.now() })
        if (payload.length > MAX_CACHE_SIZE) return // skip oversized entries
        sessionStorage.setItem(CACHE_PREFIX + key, payload)
    } catch { /* quota */ }
}

// ── Source Fetching ─────────────────────────────────────────

/**
 * Fetch realm/package source from gnoweb $source page.
 * Parses HTML to extract .gno file contents.
 */
export async function fetchRealmSource(
    gnowebBaseUrl: string,
    realmPath: string,
): Promise<RealmSource | null> {
    if (!isValidRealmPath(realmPath)) return null

    const cacheKey = `source_${realmPath}`
    const cached = getCached<RealmSource>(cacheKey)
    if (cached) return cached

    try {
        const url = `${gnowebBaseUrl}${realmPath}$source`
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!resp.ok) return null

        const html = await resp.text()
        const result = parseSourceHtml(html, realmPath)

        // Also fetch function signatures from $help
        const helpFuncs = await fetchRealmHelp(gnowebBaseUrl, realmPath)
        if (helpFuncs.length > 0) {
            result.functions = helpFuncs
        }

        setCache(cacheKey, result)
        return result
    } catch {
        return null
    }
}

// ── HTML Parsing: $source ───────────────────────────────────

/**
 * Parse gnoweb $source HTML into structured source data.
 *
 * Known gnoweb formats:
 * 1. <pre class="source-code">...code...</pre> — concatenated source
 * 2. File sections with <h3>filename.gno</h3><pre>...code...</pre>
 * 3. Single <code> block with all source
 */
function parseSourceHtml(html: string, realmPath: string): RealmSource {
    const files: SourceFile[] = []
    const imports = new Set<string>()

    // Try format: multiple file sections
    // Pattern: look for file name headings followed by code blocks
    const fileBlockPattern = /<h[23][^>]*>([^<]*\.gno)<\/h[23]>\s*<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi
    let match: RegExpExecArray | null
    while ((match = fileBlockPattern.exec(html)) !== null) {
        const name = decodeHtmlEntities(match[1].trim())
        const content = decodeHtmlEntities(match[2])
        files.push({ name, content, lines: content.split("\n").length })
        extractImports(content, imports)
    }

    // Fallback: single large code block
    if (files.length === 0) {
        const singleBlock = html.match(/<pre[^>]*(?:class="[^"]*source[^"]*")?[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/i)
            || html.match(/<pre[^>]*(?:class="[^"]*source[^"]*")?[^>]*>([\s\S]*?)<\/pre>/i)

        if (singleBlock) {
            const rawContent = decodeHtmlEntities(singleBlock[1])
            // Try to split by "package" declarations (multiple files concatenated)
            const fileParts = splitByPackageDecl(rawContent, realmPath)
            for (const fp of fileParts) {
                files.push(fp)
                extractImports(fp.content, imports)
            }
        }
    }

    // Extract functions from source code if $help didn't provide them
    const functions: FunctionSignature[] = []
    for (const f of files) {
        extractFunctions(f.content, functions)
    }

    // Find gno.mod
    const gnoMod = files.find(f => f.name === "gno.mod")

    return {
        files,
        functions,
        imports: Array.from(imports).sort(),
        gnoModContent: gnoMod?.content,
    }
}

// ── HTML Parsing: $help ─────────────────────────────────────

/**
 * Fetch function help from gnoweb $help page.
 * Extracts exported function signatures.
 */
export async function fetchRealmHelp(
    gnowebBaseUrl: string,
    realmPath: string,
): Promise<FunctionSignature[]> {
    if (!isValidRealmPath(realmPath)) return []

    try {
        const url = `${gnowebBaseUrl}${realmPath}$help`
        const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!resp.ok) return []

        const html = await resp.text()
        return parseHelpHtml(html)
    } catch {
        return []
    }
}

function parseHelpHtml(html: string): FunctionSignature[] {
    const functions: FunctionSignature[] = []

    // Pattern: func signatures in the help page
    // Common format: <code>func FuncName(params) returns</code>
    const funcPattern = /func\s+([A-Z]\w*)\(([^)]*)\)\s*(\S*)/g
    let match: RegExpExecArray | null
    const decoded = decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))

    while ((match = funcPattern.exec(decoded)) !== null) {
        functions.push({
            name: match[1],
            params: `(${match[2]})`,
            returns: match[3] || "",
            isExported: true,
        })
    }

    return functions
}

// ── Helpers ─────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
}

function extractImports(code: string, imports: Set<string>): void {
    // Single import
    const singleImport = /import\s+"([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = singleImport.exec(code)) !== null) {
        imports.add(m[1])
    }

    // Block import
    const blockImport = /import\s*\(([\s\S]*?)\)/g
    while ((m = blockImport.exec(code)) !== null) {
        const block = m[1]
        const pathPattern = /"([^"]+)"/g
        let pm: RegExpExecArray | null
        while ((pm = pathPattern.exec(block)) !== null) {
            imports.add(pm[1])
        }
    }
}

function extractFunctions(code: string, functions: FunctionSignature[]): void {
    const funcPattern = /^func\s+([A-Za-z_]\w*)\(([^)]*)\)\s*(.*?)(?:\s*\{|$)/gm
    let m: RegExpExecArray | null
    while ((m = funcPattern.exec(code)) !== null) {
        const name = m[1]
        const isExported = name[0] === name[0].toUpperCase() && name[0] !== "_"
        // Avoid duplicates
        if (!functions.some(f => f.name === name)) {
            functions.push({
                name,
                params: `(${m[2]})`,
                returns: m[3].trim().replace(/\{$/, "").trim(),
                isExported,
            })
        }
    }
}

/**
 * Split concatenated source into individual files by detecting
 * `package` declarations (heuristic: a new package line = new file).
 */
function splitByPackageDecl(content: string, realmPath: string): SourceFile[] {
    const lines = content.split("\n")

    // If only one package declaration, treat as single file
    const pkgLines = lines.reduce((acc, line, idx) => {
        if (/^package\s+\w+/.test(line.trim())) acc.push(idx)
        return acc
    }, [] as number[])

    if (pkgLines.length <= 1) {
        // Single file — derive name from realm path
        const pathParts = realmPath.split("/")
        const name = (pathParts[pathParts.length - 1] || "source") + ".gno"
        return [{ name, content, lines: lines.length }]
    }

    // Multiple files — split at each package declaration
    const files: SourceFile[] = []
    for (let i = 0; i < pkgLines.length; i++) {
        const start = pkgLines[i]
        const end = i < pkgLines.length - 1 ? pkgLines[i + 1] : lines.length
        const fileContent = lines.slice(start, end).join("\n").trim()
        // Try to detect file name from comments before package declaration
        const nameComment = start > 0 ? lines[start - 1].match(/\/\/\s*(\w+\.gno)/) : null
        const name = nameComment ? nameComment[1] : `file_${i}.gno`
        files.push({ name, content: fileContent, lines: end - start })
    }

    return files
}
