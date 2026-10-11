const MAX_STEM_BYTES = 100
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i

function boundedBytes(value: string, max: number): string {
    const encoder = new TextEncoder()
    let out = '', size = 0
    for (const character of value) {
        size += encoder.encode(character).length
        if (size > max) break
        out += character
    }
    return out
}
const trimEdges = (value: string) => value.replace(/^[\s.-]+|[\s.-]+$/gu, '')

/** A Markdown download name derived from a note title that is safe on Windows, macOS and Linux. */
export function noteExportFilename(title: string): string {
    let stem = title.normalize('NFC')
        .replace(/\p{White_Space}+/gu, ' ')
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/ {2,}/g, ' ')
    stem = trimEdges(boundedBytes(trimEdges(stem), MAX_STEM_BYTES))
    if (!stem) return 'note.md'
    if (RESERVED_WINDOWS_NAME.test(stem.split('.')[0])) stem += '-note'
    return `${stem}.md`
}
