/**
 * NftLaneV2 — the NFT lane rebuilt on the v2 foundation (marketplace-v2 Phase 7.1).
 *
 * The whole lane is now: fetch verified collections → `nftToCard` → `LaneView` (which
 * handles the toolbar / filters / skeleton / error / empty / grid). Replaces the old
 * `NftLane`'s inline-style + JS-hover cards and ad-hoc `useEffect` fetch. Swapped into
 * the shell at cutover; kept separate until browser-verified.
 *
 * @module components/marketplace/NftLaneV2
 */
import { useParams } from "react-router-dom"
import { LaneView } from "./LaneView"
import { fetchVerifiedCollections, type HubCollection } from "../../lib/nftHub"
import { nftToCard } from "../../lib/marketplace/adapters/nftToCard"

export default function NftLaneV2() {
    const { network = "test13" } = useParams()
    return (
        <LaneView<HubCollection>
            lane="nft"
            fetchFn={() => fetchVerifiedCollections()}
            toCard={(col) => nftToCard(col, network)}
            empty={{
                icon: "ti-photo",
                title: "No collections yet",
                body: "Be the first to launch one on Memba.",
            }}
        />
    )
}
