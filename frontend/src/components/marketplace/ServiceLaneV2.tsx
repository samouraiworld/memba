/**
 * ServiceLaneV2 — the Services lane rebuilt on the v2 foundation (marketplace-v2 7.2).
 *
 * There is no live services read yet (the old `ServiceLane` was `SERVICES = []`; escrow_v3
 * is flag-gated OFF until de-gate). So the lane's supply is the Founding-Supply seed
 * catalogue — the plan's intent (seed converts to real on-chain listings at de-gate).
 * When real listings exist, swap `fetchFn` for the real read; nothing else changes.
 * Category chips come from the seed taxonomy. Gated OFF in prod (`VITE_ENABLE_SERVICES`).
 *
 * @module components/marketplace/ServiceLaneV2
 */
import { LaneView } from "./LaneView"
import { seedServiceToCard } from "../../lib/marketplace/adapters/seedToCard"
import { seedServices, type SeedService } from "../../lib/marketplace/seed/foundingSupply.seed"

const SERVICE_CATEGORIES = Array.from(new Set(seedServices.map((s) => s.category)))

export default function ServiceLaneV2() {
    return (
        <LaneView<SeedService>
            lane="service"
            fetchFn={async () => seedServices}
            toCard={seedServiceToCard}
            categories={SERVICE_CATEGORIES}
            empty={{
                icon: "ti-briefcase",
                title: "No services yet",
                body: "Offer your skills to the Gno ecosystem.",
            }}
        />
    )
}
