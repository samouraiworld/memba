/** La Suite Meet's 3-4-3 room IDs are also the invitation secret. */
export const VISIO_ORIGIN = "https://visio.samourai.app"
const ROOM_ID = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/
const COMPACT_ID = /^[a-z0-9]{10}$/
const ALPHABET = "abcdefghijklmnopqrstuvwxyz"

export function newRoomId(): string {
    // Discard bytes outside the largest multiple of 26 below 256 to avoid bias.
    let letters = ""
    while (letters.length < 10) {
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        for (const byte of bytes) {
            if (byte < 234) letters += ALPHABET[byte % ALPHABET.length]
            if (letters.length === 10) break
        }
    }
    return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`
}

/** Accept a room code or a Visio invite, never a URL on another origin. */
export function normaliseRoomId(input: string): string | null {
    let value = input.trim()
    if (value.startsWith("http://") || value.startsWith("https://")) {
        try {
            const url = new URL(value)
            if (url.origin !== VISIO_ORIGIN || url.search || url.hash) return null
            value = url.pathname.replace(/^\//, "").replace(/\/$/, "")
        } catch { return null }
    }
    value = value.toLowerCase()
    if (COMPACT_ID.test(value)) value = `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`
    return ROOM_ID.test(value) ? value : null
}

export function roomUrl(roomId: string): string {
    return `${VISIO_ORIGIN}/${roomId}`
}
