/**
 * tokenOtcToCard — live OTC listing (`OtcListing`) → shared `CardModel`
 * (marketplace-v2 Phase 7.3). The Tokens lane fetches `fetchOtcListings` (validated by
 * the codec) and maps each through this. OTC listings carry no curation flag, so
 * `verified` is always false; reputation stays null until the purchase-gated realm.
 * Display formatting mirrors the existing lane for consistency.
 *
 * @module lib/marketplace/adapters/tokenOtcToCard
 */
import type { CardModel } from "../types"
import type { OtcListing } from "../codec"
import { formatGnotCompact } from "../../formatGnot"

function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function tokenOtcToCard(l: OtcListing, network: string): CardModel {
    // formatGnotCompact already includes the "GNOT" unit — don't append it again.
    const unit = formatGnotCompact(l.expectedUnitPrice)
    return {
        id: l.id,
        lane: "token",
        title: l.symbol,
        priceValue: Number(l.expectedUnitPrice),
        media: { kind: "monogram", seed: l.symbol },
        verified: false,
        seller: { handle: shortAddr(l.seller), address: l.seller, reputation: null },
        stats: [
            { label: "Available", value: formatGnotCompact(l.amountAvailable), mono: true },
            { label: "Unit", value: unit, mono: true },
        ],
        priceLabel: `${unit}/ea`,
        href: `/${network}/tokens/${l.symbol}`,
    }
}
