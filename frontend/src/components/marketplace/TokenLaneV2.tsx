/**
 * TokenLaneV2 — the Tokens (OTC) lane rebuilt on the v2 foundation (marketplace-v2 7.3).
 *
 * fetch OTC listings (validated by the codec) → `tokenOtcToCard` → `LaneView`. Replaces
 * the old `TokenLane` (window.location.reload + MEMBATEST hardcode). Trade actions are
 * reintroduced in the trade-panel work (Phase 5/7); this is the browse surface. Swapped
 * into the live shell at cutover (Tokens is flag-gated OFF in prod until de-gate).
 *
 * @module components/marketplace/TokenLaneV2
 */
import { useParams } from "react-router-dom"
import { LaneView } from "./LaneView"
import { fetchOtcListings } from "../../lib/tokenOtcApi"
import type { OtcListing } from "../../lib/marketplace/codec"
import { tokenOtcToCard } from "../../lib/marketplace/adapters/tokenOtcToCard"
import { getTokenDecimals } from "../../lib/grc20"
import { GNO_RPC_URL } from "../../lib/config"

type OtcListingWithDecimals = OtcListing & { decimals: number }

// T3.2: decimals per symbol, resolved before the cards render — tokenOtcToCard
// requires it (no silent default) so amounts are never displayed at the wrong
// scale. One lookup per DISTINCT symbol (getTokenDecimals also caches globally).
async function fetchOtcListingsWithDecimals(): Promise<OtcListingWithDecimals[]> {
    const rows = await fetchOtcListings()
    const symbols = [...new Set(rows.map((l) => l.symbol))]
    const decimalsBySymbol = new Map<string, number>(
        await Promise.all(symbols.map(async (s) => [s, await getTokenDecimals(GNO_RPC_URL, s)] as const)),
    )
    return rows.map((l) => ({ ...l, decimals: decimalsBySymbol.get(l.symbol) ?? 6 }))
}

export default function TokenLaneV2() {
    const { network = "test13" } = useParams()
    return (
        <LaneView<OtcListingWithDecimals>
            lane="token"
            fetchFn={fetchOtcListingsWithDecimals}
            toCard={(l) => tokenOtcToCard(l, network, l.decimals)}
            empty={{
                icon: "ti-coin",
                title: "No token listings yet",
                body: "Be the first to list on the OTC desk.",
            }}
        />
    )
}
