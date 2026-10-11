/**
 * Plain-language mirror of the Notes realm's public field rules
 * (memba_notes_v1 state.gno validateTitle / validatePublic), checked before any
 * network or wallet step. The chain codec guard (schema.ts publicText) stays the
 * authority; publicFields.test.ts keeps both in agreement.
 */
export const MAX_PUBLIC_TITLE_BYTES = 160
export const MAX_PUBLIC_TITLE_CHARACTERS = 80
export const MAX_PUBLIC_BODY_BYTES = 131_072

// Go strings.TrimSpace trims Unicode White_Space at both ends; JS trim() differs (BOM, NEL).
const EDGE_SPACE = /^\p{White_Space}+|\p{White_Space}+$/gu
const LONE_SURROGATE = /\p{Surrogate}/u

/** Removing edge whitespace is lossless for a title: the realm refuses it anyway. */
export function trimPublicTitle(title: string): string {
    return title.replace(EDGE_SPACE, '')
}

/** Returns why the realm would refuse this title once trimmed, or null when it is accepted. */
export function publicTitleProblem(title: string): string | null {
    const value = trimPublicTitle(title)
    if (value === '') return 'Add a title before publishing.'
    if (LONE_SURROGATE.test(value)) return 'The title contains an unsupported character. Retype it and try again.'
    if ([...value].length > MAX_PUBLIC_TITLE_CHARACTERS) return `The title is too long: use at most ${MAX_PUBLIC_TITLE_CHARACTERS} characters.`
    if (new TextEncoder().encode(value).length > MAX_PUBLIC_TITLE_BYTES) return `The title is too long: at most ${MAX_PUBLIC_TITLE_BYTES} bytes, and emoji or accented letters count for more than one.`
    if (value.includes('/')) return 'Titles cannot contain “/”.'
    if (/\p{Cc}/u.test(value)) return 'Titles cannot contain line breaks, tabs or other control characters.'
    if (/\p{Cf}/u.test(value)) return 'Titles cannot contain invisible formatting characters such as zero-width spaces.'
    return null
}

/** Returns why the realm would refuse this public body, or null when it is accepted. */
export function publicBodyProblem(body: string): string | null {
    if (LONE_SURROGATE.test(body)) return 'The note contains an unsupported character. Retype the affected text and try again.'
    if (new TextEncoder().encode(body).length > MAX_PUBLIC_BODY_BYTES) return 'The note is too long: public notes are limited to 128 KiB.'
    return null
}
