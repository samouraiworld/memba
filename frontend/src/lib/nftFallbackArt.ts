/**
 * nftFallbackArt.ts — deterministic, self-contained fallback artwork for NFT
 * media that has no (or an unresolvable) image URI.
 *
 * Seeded by the token/collection identity so every item gets a distinct but
 * stable tile — zero backend, no network request, no broken-image flash. The
 * markup is rendered via <img src={svgDataUri(...)}> (see badgeArt) so the SVG
 * is sandboxed (no script execution) and CSP-safe under `img-src data:`.
 *
 * Visual: a teal/black diagonal gradient with a horizontally-mirrored blockie
 * grid — keeps the marketplace on-brand and never looks broken.
 */

import { svgDataUri } from "./badgeArt"

/** Stable 32-bit FNV-1a hash so the same seed always yields the same art. */
function hash(seed: string): number {
    let h = 2166136261
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

/**
 * Deterministic teal/black fallback SVG for a given seed. The seed is typically
 * `${collectionId}/${tokenId}` (per-item) or a collection id (per-collection).
 */
export function nftFallbackSvg(seed: string): string {
    const h = hash(seed || "memba")
    const hue = 150 + (h % 55) // 150–204: teal → cyan, always on-brand
    const bgA = `hsl(${hue} 46% 9%)`
    const bgB = `hsl(${hue} 60% 16%)`
    const fg = `hsl(${(hue + 14) % 360} 72% 56%)`
    const gid = `nfg-${h.toString(36)}`

    const cells = 5
    const size = 100 / cells

    // Horizontally-mirrored blockie: columns 0..2 decide, 3..4 mirror 1..0.
    let rects = ""
    for (let y = 0; y < cells; y++) {
        for (let x = 0; x < 3; x++) {
            const on = (h >>> (y * 3 + x)) & 1
            if (!on) continue
            for (const cx of [x, cells - 1 - x]) {
                rects +=
                    `<rect x="${(cx * size).toFixed(2)}" y="${(y * size).toFixed(2)}" ` +
                    `width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="2"/>`
            }
        }
    }

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Generated artwork">` +
        `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs>` +
        `<rect width="100" height="100" fill="url(#${gid})"/>` +
        `<g fill="${fg}" fill-opacity="0.85" transform="translate(15 15) scale(0.7)">${rects}</g>` +
        `</svg>`
    )
}

/** Ready-to-use `data:` URI for the seeded fallback art (for <img src>). */
export function nftFallbackUri(seed: string): string {
    return svgDataUri(nftFallbackSvg(seed))
}
