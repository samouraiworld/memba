/**
 * nftToCard — live NFT collection (`HubCollection`) → shared `CardModel`
 * (marketplace-v2 Phase 7.1). The real counterpart to `seedNftToCard`: the NFT lane's
 * `LaneView` fetches collections via `fetchVerifiedCollections` and maps them through
 * this. `verified` is read from the AUTHORITATIVE curation check (per-collection), never
 * from listing metadata; reputation stays null until the purchase-gated realm lands.
 *
 * @module lib/marketplace/adapters/nftToCard
 */
import type { CardModel } from "../types"
import type { HubCollection } from "../../nftHub"
import { nftFallbackUri } from "../../nftFallbackArt"
import { formatGnotCompact } from "../../formatGnot"

/** Short display form of a bech32 address (full value kept in CardModel.seller.address). */
function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function nftToCard(col: HubCollection, network: string): CardModel {
    // formatGnotCompact already includes the "GNOT" unit — do NOT append it again.
    const floor = formatGnotCompact(col.floorUgnot)
    return {
        id: col.id,
        lane: "nft",
        title: col.name,
        priceValue: Number(col.floorUgnot),
        media: { kind: "art", src: nftFallbackUri(col.id) },
        verified: col.verified,
        seller: { handle: shortAddr(col.creator), address: col.creator, reputation: null },
        stats: [
            { label: "Floor", value: floor, mono: true },
            { label: "Volume", value: formatGnotCompact(col.volumeUgnot), mono: true },
        ],
        priceLabel: floor,
        href: `/${network}/nft/collection/${col.id}`,
    }
}
