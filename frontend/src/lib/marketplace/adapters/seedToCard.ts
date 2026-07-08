/**
 * seedToCard — map Founding-Supply seed rows to the shared `CardModel`
 * (marketplace-v2 Phase 2). Pure functions; one per lane. They drive the design
 * fixtures now and mirror the shape the real UnifiedListing→CardModel adapters
 * produce later, so `MarketCard`/`ListingGrid` render seed and real data identically.
 *
 * Seed carries NO reputation → these NEVER fabricate one (reputation stays null;
 * `MarketCard` shows "New seller"). `verified` here is the seed's curation flag —
 * acceptable for non-prod fixtures; real listings read `verified` from the
 * authoritative curation realm keyed by seller address.
 *
 * @module lib/marketplace/adapters/seedToCard
 */
import type { CardModel, CardMedia } from "../types"
import type { SeedNft, SeedService, SeedToken } from "../seed/foundingSupply.seed"
import { nftFallbackUri } from "../../nftFallbackArt"

/** Seed prices are whole GNOT (not ugnot); format plainly. */
const gnot = (n: number): string => `${n.toLocaleString("en-US")} GNOT`

type SeedLike = { id: string; media: { kind: "art" | "monogram"; monogramSeed?: string } }

/** Art seeds get deterministic fallback art; monogram seeds get the gradient tile. */
function seedMedia(s: SeedLike): CardMedia {
    return s.media.kind === "art"
        ? { kind: "art", src: nftFallbackUri(s.id) }
        : { kind: "monogram", seed: s.media.monogramSeed ?? s.id }
}

/** Seed carries no reputation — never fabricate one. */
function seedSeller(s: { seller: { handle: string; address: string } }): CardModel["seller"] {
    return { handle: s.seller.handle, address: s.seller.address, reputation: null }
}

export function seedNftToCard(s: SeedNft): CardModel {
    return {
        id: s.id,
        lane: "nft",
        title: s.title,
        media: seedMedia(s),
        verified: s.seller.verified,
        seller: seedSeller(s),
        stats: [
            { label: "Floor", value: gnot(s.floorGnot), mono: true },
            { label: "Volume", value: gnot(s.volumeGnot), mono: true },
            { label: "Items", value: s.itemCount.toLocaleString("en-US"), mono: true },
        ],
        priceLabel: gnot(s.floorGnot),
        href: `#seed-${s.id}`,
    }
}

export function seedServiceToCard(s: SeedService): CardModel {
    const from = Math.min(...s.packages.map((p) => p.priceGnot))
    const basic = s.packages.find((p) => p.name === "Basic") ?? s.packages[0]
    return {
        id: s.id,
        lane: "service",
        title: s.gigTitle || s.title,
        media: seedMedia(s),
        verified: s.seller.verified,
        seller: seedSeller(s),
        stats: [
            { label: "Delivery", value: `${basic.deliveryDays}d` },
            { label: "Level", value: s.sellerLevel },
        ],
        priceLabel: `From ${gnot(from)}`,
        href: `#seed-${s.id}`,
    }
}

export function seedTokenToCard(s: SeedToken): CardModel {
    return {
        id: s.id,
        lane: "token",
        title: s.symbol,
        media: seedMedia(s),
        verified: s.seller.verified,
        seller: seedSeller(s),
        stats: [
            { label: "Available", value: s.amountAvailable.toLocaleString("en-US"), mono: true },
            { label: "Min fill", value: s.minFillAmount.toLocaleString("en-US"), mono: true },
        ],
        priceLabel: `${gnot(s.unitPriceGnot)}/ea`,
        href: `#seed-${s.id}`,
    }
}
