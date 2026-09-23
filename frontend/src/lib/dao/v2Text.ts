/**
 * Text rules of version-2 DAO proposals, mirrored from the realm
 * (templates/dao/v2/realm.ts checkTitle / checkDescription) so a form can
 * refuse what the chain would refuse before anyone signs, plus helpers to show
 * proposal text without letting invisible characters change how it reads.
 */

export const V2_MAX_TITLE_CHARS = 128
export const V2_MAX_DESCRIPTION_CHARS = 8000

const runes = (s: string) => Array.from(s).length

function isControl(cp: number): boolean {
    return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029
}

/** Format characters: what the realm refuses in titles (mirrored exactly by v2TitleProblem). */
const FORMAT_CHAR = /\p{Cf}/u

/**
 * Characters shown as [U+XXXX] wherever chain text is displayed: format
 * characters (zero-width, bidi controls, byte-order marks, tags), variation
 * selectors (U+FE00–FE0F, U+E0100–E01EF, Mongolian U+180B–180D, U+180F) and
 * the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), which all draw nothing
 * or change a neighbour.
 */
const INVISIBLE_CHAR = /[\p{Cf}\p{Variation_Selector}\u115F\u1160\u3164\uFFA0]/u
const INVISIBLE_CHARS = new RegExp(INVISIBLE_CHAR.source, "gu")

/** Why the realm would refuse this title, or null. */
export function v2TitleProblem(title: string): string | null {
    const n = runes(title)
    if (n < 1 || title.trim() === "") return "Enter a title."
    if (n > V2_MAX_TITLE_CHARS) return `The title must be at most ${V2_MAX_TITLE_CHARS} characters.`
    for (const ch of title) {
        if (isControl(ch.codePointAt(0)!)) return "The title must be a single line without control characters."
    }
    if (FORMAT_CHAR.test(title)) return "The title contains invisible formatting characters. Remove them."
    return null
}

/** Why the realm would refuse this description, or null. */
export function v2DescriptionProblem(description: string): string | null {
    if (runes(description) > V2_MAX_DESCRIPTION_CHARS) return `The description must be at most ${V2_MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters.`
    for (const ch of description) {
        const cp = ch.codePointAt(0)!
        if (isControl(cp) && ch !== "\n" && ch !== "\t") return "The description contains control characters. Only line breaks and tabs are allowed."
    }
    return null
}

/** Character count as the realm counts it (code points). */
export function v2CharCount(s: string): number {
    return runes(s)
}

/**
 * True when the text holds invisible characters (zero-width spaces,
 * bidirectional controls, byte-order marks, variation selectors, fillers). The
 * realm accepts them in descriptions; they can make text read differently from
 * what it contains.
 */
export function hasInvisibleFormatting(s: string): boolean {
    return INVISIBLE_CHAR.test(s)
}

/** Remove every invisible character (for recognising an address split by one). */
export function stripInvisibleFormatting(s: string): string {
    return s.replace(INVISIBLE_CHARS, "")
}

/** Replace each invisible character with a visible `[U+XXXX]` marker. */
export function revealInvisibleFormatting(s: string): string {
    return s.replace(INVISIBLE_CHARS, (ch) => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`)
}
