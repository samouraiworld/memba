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

export default function TokenLaneV2() {
    const { network = "test13" } = useParams()
    return (
        <LaneView<OtcListing>
            lane="token"
            fetchFn={() => fetchOtcListings()}
            toCard={(l) => tokenOtcToCard(l, network)}
            empty={{
                icon: "ti-coin",
                title: "No token listings yet",
                body: "Be the first to list on the OTC desk.",
            }}
        />
    )
}
