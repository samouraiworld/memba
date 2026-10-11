/**
 * Pure three-way merge for public note drafts. It never invents text: a change is
 * applied only when the other side left that region untouched, and anything else is a
 * conflict that keeps the caller's text as it is.
 */
export type TextMerge = { status: 'clean'; value: string } | { status: 'conflict' }
export interface NoteText { title: string; body: string }
/** A null field means its base bytes are unavailable (redacted, deleted or unknown). */
export interface NoteBaseText { title: string | null; body: string | null }
export type NoteMerge = { status: 'clean'; title: string; body: string } | { status: 'conflict'; fields: ('title' | 'body')[] }

/** Comparison table bound (cells). Larger rewrites are reported as conflicts, never truncated. */
const MAX_CELLS = 4_000_000
type Hunk = { start: number; end: number; lines: string[] }

/** Whole-value merge: titles are short and a partial title merge would read as nonsense. */
export function mergeTitle(base: string | null, ours: string, theirs: string): TextMerge {
    if (ours === theirs) return { status: 'clean', value: ours }
    if (base === null) return { status: 'conflict' }
    if (base === ours) return { status: 'clean', value: theirs }
    if (base === theirs) return { status: 'clean', value: ours }
    return { status: 'conflict' }
}

/** Line-based merge; overlapping or touching changes conflict unless they are identical. */
export function mergeLines(base: string | null, ours: string, theirs: string): TextMerge {
    if (ours === theirs) return { status: 'clean', value: ours }
    if (base === null) return { status: 'conflict' }
    if (base === ours) return { status: 'clean', value: theirs }
    if (base === theirs) return { status: 'clean', value: ours }
    const original = base.split('\n')
    const mine = hunks(original, ours.split('\n')), other = hunks(original, theirs.split('\n'))
    if (!mine || !other) return { status: 'conflict' }
    const accepted = [...mine]
    for (const hunk of other) {
        const touching = mine.filter(own => hunk.start <= own.end && own.start <= hunk.end)
        if (touching.length === 0) accepted.push(hunk)
        else if (touching.length !== 1 || !same(touching[0], hunk)) return { status: 'conflict' }
    }
    const result = [...original]
    for (const hunk of accepted.sort((a, b) => b.start - a.start || b.end - a.end)) result.splice(hunk.start, hunk.end - hunk.start, ...hunk.lines)
    return { status: 'clean', value: result.join('\n') }
}

export function mergeNoteText(base: NoteBaseText, ours: NoteText, theirs: NoteText): NoteMerge {
    const title = mergeTitle(base.title, ours.title, theirs.title), body = mergeLines(base.body, ours.body, theirs.body)
    if (title.status === 'clean' && body.status === 'clean') return { status: 'clean', title: title.value, body: body.value }
    return { status: 'conflict', fields: [...(title.status === 'conflict' ? ['title' as const] : []), ...(body.status === 'conflict' ? ['body' as const] : [])] }
}

function same(a: Hunk, b: Hunk): boolean {
    return a.start === b.start && a.end === b.end && a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i])
}

/** Changed base ranges [start, end) and their replacement lines, from a longest common subsequence. */
function hunks(base: string[], next: string[]): Hunk[] | null {
    let prefix = 0
    while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix++
    let suffix = 0
    while (suffix < base.length - prefix && suffix < next.length - prefix && base[base.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
    const a = base.slice(prefix, base.length - suffix), b = next.slice(prefix, next.length - suffix)
    const n = a.length, m = b.length, width = m + 1
    if ((n + 1) * width > MAX_CELLS) return null
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
    const out: Hunk[] = []
    let i = 0, j = 0, open: { i: number; j: number } | null = null
    const close = () => { if (open) out.push({ start: prefix + open.i, end: prefix + i, lines: b.slice(open.j, j) }); open = null }
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { close(); i++; j++ }
        else {
            open ??= { i, j }
            if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) j++
            else i++
        }
    }
    close()
    return out
}
