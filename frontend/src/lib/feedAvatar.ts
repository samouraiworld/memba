/**
 * feedAvatar — deterministic identity for a bech32 address, rendered as a
 * mono-glyph tile (see FeedAvatar.tsx). No external identicon lib (jazzicon/
 * blockies read web2-social and clash with Memba's terminal aesthetic): the
 * tile IS the address rendered as a chip — a hashed hue + the first two glyphs.
 *
 * @module lib/feedAvatar
 */

/** The two-glyph label: the chars after the g1 prefix, uppercased. */
export function avatarLabel(address: string): string {
    const core = address.startsWith("g1") ? address.slice(2) : address
    if (core.length === 0) return "?"
    return core.slice(0, 2).toUpperCase()
}

/** A deterministic hue [0, 360) from the address (FNV-1a over the bytes). */
export function avatarHue(address: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < address.length; i++) {
        h ^= address.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0) % 360
}
