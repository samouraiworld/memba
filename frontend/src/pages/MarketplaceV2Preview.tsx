/**
 * MarketplaceV2Preview — a dev-only visual harness (marketplace-v2 Phase 2).
 *
 * Renders the Founding-Supply seed catalog through the new `MarketCard` / `ListingGrid`
 * so the design system can be validated in the browser before the lanes are rebuilt on
 * it (Phase 7). Gated behind `VITE_ENABLE_MARKETPLACE_V2` (off in prod) — it is not part
 * of the shipped IA. Renders seed data identically to how real UnifiedListings will.
 *
 * @module pages/MarketplaceV2Preview
 */
import { Navigate } from "react-router-dom"
import ListingGrid from "../components/marketplace/ListingGrid"
import { LaneToolbar } from "../components/marketplace/LaneToolbar"
import { seedNftToCard, seedServiceToCard, seedTokenToCard } from "../lib/marketplace/adapters/seedToCard"
import { seedNfts, seedServices, seedTokens } from "../lib/marketplace/seed/foundingSupply.seed"
import { useMarketFilters } from "../lib/marketplace/useMarketFilters"
import { applyFilters } from "../lib/marketplace/marketFilters"
import { isMarketplaceV2Enabled } from "../lib/config"

const NFT_CARDS = seedNfts.map(seedNftToCard)
const SERVICE_CARDS = seedServices.map(seedServiceToCard)
const TOKEN_CARDS = seedTokens.map(seedTokenToCard)
const LANES = [
    { key: "NFT", cards: NFT_CARDS },
    { key: "Services", cards: SERVICE_CARDS },
    { key: "Tokens", cards: TOKEN_CARDS },
] as const

export default function MarketplaceV2Preview() {
    // Shared discovery state (URL-synced). Hook must run before any early return.
    const { filters, setFilters } = useMarketFilters()

    // Dev-only harness — never reachable in prod (flag off).
    if (!isMarketplaceV2Enabled()) return <Navigate to="../marketplace" replace />

    return (
        <div className="mktv2-preview" style={{ maxWidth: "1200px", margin: "0 auto", padding: "var(--space-6, 24px)" }}>
            <header style={{ marginBottom: "var(--space-6, 24px)" }}>
                <h1 style={{ fontFamily: "var(--font-sans)", margin: 0 }}>Marketplace v2 — design preview</h1>
                <p className="k-text-muted" style={{ margin: "var(--space-2, 8px) 0 0" }}>
                    Founding-Supply seed catalog through the new MarketCard / ListingGrid, filtered by the shared LaneToolbar. Seed data — not live inventory.
                </p>
            </header>

            <LaneToolbar filters={filters} onChange={setFilters} />

            {LANES.map(({ key, cards }) => {
                const shown = applyFilters(cards, filters)
                return (
                    <section key={key} style={{ marginBottom: "var(--space-8, 32px)" }}>
                        <h2 style={{ fontFamily: "var(--font-sans)" }}>{key} · {shown.length}</h2>
                        <ListingGrid items={shown} />
                    </section>
                )
            })}
        </div>
    )
}
