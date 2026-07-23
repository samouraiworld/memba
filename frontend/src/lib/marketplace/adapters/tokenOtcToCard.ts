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
import { formatTokenAmount } from "../../grc20"

function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/**
 * T3.2: `l.amountAvailable` is BASE UNITS and `l.expectedUnitPrice` is ugnot PER
 * BASE UNIT — neither is ugnot-denominated at whole-token scale, so
 * `formatGnotCompact` (a ugnot/1e6 formatter) previously mis-displayed both.
 * `decimals` is a REQUIRED param (not defaulted) so a caller can't silently
 * paper over a symbol it hasn't actually looked up yet — see TokenLaneV2's
 * getTokenDecimals-backed fetch.
 */
export function tokenOtcToCard(l: OtcListing, network: string, decimals: number): CardModel {
    const scale = 10n ** BigInt(decimals)
    // formatGnotCompact already includes the "GNOT" unit — don't append it again.
    const unit = formatGnotCompact(l.expectedUnitPrice * scale) // per WHOLE token, not per base unit
    return {
        id: l.id,
        lane: "token",
        title: l.symbol,
        priceValue: Number(l.expectedUnitPrice * scale),
        media: { kind: "monogram", seed: l.symbol },
        verified: false,
        seller: { handle: shortAddr(l.seller), address: l.seller, reputation: null },
        stats: [
            { label: "Available", value: `${formatTokenAmount(l.amountAvailable, decimals)} ${l.symbol}`, mono: true },
            { label: "Unit", value: unit, mono: true },
        ],
        priceLabel: `${unit}/ea`,
        href: `/${network}/tokens/${l.symbol}`,
    }
}
