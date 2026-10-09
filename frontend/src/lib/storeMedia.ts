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
    /** Contrasting plate for a transparent mark, independent of the brand accent. */
    logoBackground?: string
    /** 16:9, 1600×900: /store/<key>/cover.webp */
    cover?: string
    /** At most 6: /store/<key>/shot-N.webp */
    screenshots: readonly string[]
    accent: string
    /** Where each third-party asset was taken from, and when. Empty for our own games. */
    sources: readonly MediaSource[]
}
export interface ResolvedMedia { logoBackground?: string; logo: string | null; cover: string | null; screenshots: string[]; accent: string }

/** Keys: an editorial project id or an Arcade game id. Third-party sources and retrieval dates are recorded per entry. */
export const STORE_MEDIA: Readonly<Record<string, StoreMedia>> = {
    "barricade": { logo: "/store/barricade/logo.webp", cover: "/store/barricade/cover.webp", screenshots: ["/store/barricade/shot-1.webp", "/store/barricade/shot-2.webp", "/store/barricade/shot-3.webp", "/store/barricade/shot-4.webp"], accent: "#2A1E14", sources: [] },
    "block-party": { logo: "/store/block-party/logo.svg", cover: "/store/block-party/cover.webp", screenshots: ["/store/block-party/shot-1.webp", "/store/block-party/shot-2.webp", "/store/block-party/shot-3.webp", "/store/block-party/shot-4.webp"], accent: "#2A1238", sources: [] },
    "space-invaders": { logo: "/store/space-invaders/logo.svg", cover: "/store/space-invaders/cover.webp", screenshots: ["/store/space-invaders/shot-1.webp", "/store/space-invaders/shot-2.webp", "/store/space-invaders/shot-3.webp", "/store/space-invaders/shot-4.webp", "/store/space-invaders/shot-5.webp"], accent: "#04120F", sources: [] },
    "connect4": { logo: "/store/connect4/logo.svg", cover: "/store/connect4/cover.webp", screenshots: ["/store/connect4/shot-1.webp", "/store/connect4/shot-2.webp", "/store/connect4/shot-3.webp", "/store/connect4/shot-4.webp"], accent: "#0B1838", sources: [] },
    "adena": { logo: "/store/adena/logo.svg", cover: "/store/adena/cover.webp", screenshots: ["/store/adena/shot-1.webp", "/store/adena/shot-2.webp", "/store/adena/shot-3.webp", "/store/adena/shot-4.webp", "/store/adena/shot-5.webp"], accent: "#0059FF", sources: [{ url: "https://framerusercontent.com/images/dmtigUBWPfehtU4uA53YMaVlaI.svg", retrieved: "2026-10-08" }, { url: "https://framerusercontent.com/assets/97TpHy8n0vxA54ojDWTKPqonBXw.png", retrieved: "2026-10-08" }, { url: "https://www.adena.app/", retrieved: "2026-10-08" }, { url: "https://docs.adena.app/user-guide/download", retrieved: "2026-10-08" }] },
    "gnoswap": { logo: "/store/gnoswap/logo.svg", logoBackground: "#F5F7FA", cover: "/store/gnoswap/cover.webp", screenshots: ["/store/gnoswap/shot-1.webp", "/store/gnoswap/shot-2.webp", "/store/gnoswap/shot-3.webp", "/store/gnoswap/shot-4.webp", "/store/gnoswap/shot-5.webp"], accent: "#233DBD", sources: [{ url: "https://gnoswap.io/favicon.svg", retrieved: "2026-10-08" }, { url: "https://gnoswap.io/", retrieved: "2026-10-08" }, { url: "https://gnoswap.io/earn", retrieved: "2026-10-08" }, { url: "https://gnoswap.io/explore", retrieved: "2026-10-08" }, { url: "https://gnoswap.io/governance", retrieved: "2026-10-08" }, { url: "https://gnoswap.io/launchpad", retrieved: "2026-10-08" }] },
    "boards": { logo: "/store/boards/logo.svg", logoBackground: "#F5F7FA", cover: "/store/boards/cover.webp", screenshots: ["/store/boards/shot-1.webp", "/store/boards/shot-2.webp", "/store/boards/shot-3.webp", "/store/boards/shot-4.webp"], accent: "#226C57", sources: [{ url: "https://gno.land/public/imgs/gnoland.svg", retrieved: "2026-10-08" }, { url: "https://gno.land/r/gnoland/boards2/v0$source", retrieved: "2026-10-08" }, { url: "https://gno.land/r/gnoland/boards2/v0$state", retrieved: "2026-10-08" }, { url: "https://gno.land/r/gnoland/boards2/v0$help", retrieved: "2026-10-08" }] },
    "akkadia": { logo: "/store/akkadia/logo.webp", cover: "/store/akkadia/cover.webp", screenshots: ["/store/akkadia/shot-1.webp", "/store/akkadia/shot-2.webp", "/store/akkadia/shot-3.webp"], accent: "#2B2B2B", sources: [{ url: "https://pbs.twimg.com/profile_images/2052284686639194112/HbnMYC2z_400x400.jpg", retrieved: "2026-10-08" }, { url: "https://abp.akkadia.land/share/card.v2.jpg", retrieved: "2026-10-08" }, { url: "https://abp.akkadia.land/", retrieved: "2026-10-08" }] },
    "bubble-rumble": { logo: "/store/bubble-rumble/logo.webp", cover: "/store/bubble-rumble/cover.webp", screenshots: ["/store/bubble-rumble/shot-1.webp", "/store/bubble-rumble/shot-2.webp", "/store/bubble-rumble/shot-3.webp", "/store/bubble-rumble/shot-4.webp"], accent: "#070B16", sources: [{ url: "https://bubblerumble.net/brand/br-bubble-640.png", retrieved: "2026-10-08" }, { url: "https://bubblerumble.net/og.jpg", retrieved: "2026-10-08" }, { url: "https://bubblerumble.net/", retrieved: "2026-10-08" }, { url: "https://bubblerumble.net/brand/", retrieved: "2026-10-08" }] },
    "gnofly": { logo: "/store/gnofly/logo.svg", cover: "/store/gnofly/cover.webp", screenshots: ["/store/gnofly/shot-1.webp", "/store/gnofly/shot-2.webp", "/store/gnofly/shot-3.webp"], accent: "#15171C", sources: [{ url: "https://gnofly.xyz/favicon-gdk9fn8v.svg", retrieved: "2026-10-08" }, { url: "https://gnofly.xyz/", retrieved: "2026-10-08" }, { url: "https://gnofly.xyz/nft", retrieved: "2026-10-08" }, { url: "https://gnofly.xyz/hangar", retrieved: "2026-10-08" }] },
    // Homepage captures requested for the editorial listing; no live embed.
    "gnogolf": { cover: "/store/gnogolf/cover.jpg", screenshots: ["/store/gnogolf/shot-1.jpg"], accent: "#276749", sources: [{ url: "https://gnogolf.xyz/", retrieved: "2026-10-09" }] },
    "kourt": { logo: "/store/kourt/logo.webp", logoBackground: "#18232D", cover: "/store/kourt/cover.webp", screenshots: ["/store/kourt/shot-1.webp", "/store/kourt/shot-2.webp", "/store/kourt/shot-3.webp", "/store/kourt/shot-4.webp"], accent: "#E6EDF2", sources: [{ url: "https://kourt.xyz/", retrieved: "2026-10-08" }, { url: "https://kourt.xyz/og.png", retrieved: "2026-10-08" }, { url: "https://kourt.xyz/#/about", retrieved: "2026-10-08" }, { url: "https://kourt.xyz/#/params", retrieved: "2026-10-08" }, { url: "https://kourt.xyz/#/ai", retrieved: "2026-10-08" }] },
    "gnoscan": { logo: "/store/gnoscan/logo.svg", cover: "/store/gnoscan/cover.webp", screenshots: ["/store/gnoscan/shot-1.webp", "/store/gnoscan/shot-2.webp", "/store/gnoscan/shot-3.webp", "/store/gnoscan/shot-4.webp"], accent: "#000000", sources: [{ url: "https://gnoscan.io/favicon.svg", retrieved: "2026-10-08" }, { url: "https://gnoscan.io/gnoscan-thumb.png", retrieved: "2026-10-08" }, { url: "https://gnoscan.io/", retrieved: "2026-10-08" }, { url: "https://gnoscan.io/blocks", retrieved: "2026-10-08" }, { url: "https://gnoscan.io/realms", retrieved: "2026-10-08" }, { url: "https://gnoscan.io/validators", retrieved: "2026-10-08" }] },
    "playground": { logo: "/store/playground/logo.svg", logoBackground: "#F5F7FA", cover: "/store/playground/cover.webp", screenshots: ["/store/playground/shot-1.webp", "/store/playground/shot-2.webp", "/store/playground/shot-3.webp", "/store/playground/shot-4.webp"], accent: "#226C57", sources: [{ url: "https://gno.land/public/imgs/gnoland.svg", retrieved: "2026-10-08" }, { url: "https://play.gno.land/og-playground-2.png", retrieved: "2026-10-08" }, { url: "https://play.gno.land/", retrieved: "2026-10-08" }, { url: "https://play.gno.land/?file=token.gno", retrieved: "2026-10-08" }, { url: "https://play.gno.land/?file=counter.gno", retrieved: "2026-10-08" }] },
    "mygnoscan": { logo: "/store/mygnoscan/logo.svg", cover: "/store/mygnoscan/cover.webp", screenshots: ["/store/mygnoscan/shot-1.webp", "/store/mygnoscan/shot-2.webp", "/store/mygnoscan/shot-3.webp", "/store/mygnoscan/shot-4.webp"], accent: "#4ECDC4", sources: [{ url: "https://gnoscope.com/", retrieved: "2026-10-08" }, { url: "https://gnoscope.com/storage?network=mainnet", retrieved: "2026-10-08" }, { url: "https://gnoscope.com/analytics?network=mainnet", retrieved: "2026-10-08" }, { url: "https://gnoscope.com/realms?network=mainnet", retrieved: "2026-10-08" }, { url: "https://gnoscope.com/validators?network=mainnet", retrieved: "2026-10-08" }] },
}

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
        ...(curated?.logo && curated.logoBackground ? { logoBackground: curated.logoBackground } : {}),
        cover: curated?.cover ?? screenshots[0] ?? null,
        screenshots,
        accent: curated?.accent ?? hueAccent(seed),
    }
}
