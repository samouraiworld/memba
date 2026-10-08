/**
 * Storefront media: the committed logo, cover, screenshots and accent of each
 * Arcade game and curated app (files in frontend/public/store/<key>/), and how
 * an entry's media is resolved against its on-chain listing. Curated media wins
 * over listing CIDs; any other listing is shown with its own CIDs, as-is.
 */
import { API_BASE_URL } from "./config"
import { isValidCid } from "./ipfs"

export interface MediaSource { url: string; retrieved: string }
export interface StoreMedia {
    /** Square, ≥256 px: /store/<key>/logo.svg or logo.webp */
    logo?: string
    /** 16:9, 1600×900: /store/<key>/cover.webp */
    cover?: string
    /** At most 6: /store/<key>/shot-N.webp */
    screenshots: readonly string[]
    accent: string
    /** Where each third-party asset was taken from, and when. Empty for our own games. */
    sources: readonly MediaSource[]
}
export interface ResolvedMedia { logo: string | null; cover: string | null; screenshots: string[]; accent: string }

/** Filled by the media PR. Keys: an editorial project id or an Arcade game id. */
export const STORE_MEDIA: Readonly<Record<string, StoreMedia>> = {}

/** Registry listings that are one of our curated entries: listing pkgPath → media key. */
export const MEDIA_KEY_BY_REALM: Readonly<Record<string, string>> = {
    "gno.land/r/samcrew/block_party": "block-party",
    "gno.land/r/samcrew/space_invaders": "space-invaders",
    "gno.land/r/samcrew/barricade": "barricade",
    "gno.land/r/samcrew/connect4": "connect4",
    "gno.land/r/gnoswap/router": "gnoswap",
    "gno.land/r/gnoland/boards2/v0": "boards",
}

export function cidImageUrl(cid: string): string {
    return `${API_BASE_URL}/api/nft/image?cid=${encodeURIComponent(cid)}`
}

export function hueAccent(seed: string): string {
    const hue = [...seed].reduce((n, char) => (n * 33 + char.charCodeAt(0)) % 360, 0)
    return `hsl(${hue} 55% 42%)`
}

export function mediaKeyFor(projectId?: string | null, realmPath?: string | null): string | null {
    if (projectId) return projectId
    return realmPath && Object.hasOwn(MEDIA_KEY_BY_REALM, realmPath) ? MEDIA_KEY_BY_REALM[realmPath] : null
}

export function resolveMedia(
    key: string | null,
    listing: { iconCID?: string; screenshotCIDs?: readonly string[] } | null | undefined,
    seed: string,
    manifest: Readonly<Record<string, StoreMedia>> = STORE_MEDIA,
): ResolvedMedia {
    const curated = key !== null && Object.hasOwn(manifest, key) ? manifest[key] : undefined
    const listingShots = (listing?.screenshotCIDs ?? []).filter(isValidCid).map(cidImageUrl)
    const screenshots = curated?.screenshots.length ? [...curated.screenshots] : listingShots
    const icon = listing?.iconCID && isValidCid(listing.iconCID) ? cidImageUrl(listing.iconCID) : null
    return {
        logo: curated?.logo ?? icon,
        cover: curated?.cover ?? screenshots[0] ?? null,
        screenshots,
        accent: curated?.accent ?? hueAccent(seed),
    }
}
