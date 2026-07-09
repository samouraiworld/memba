/**
 * types.ts — the unified marketplace asset model.
 *
 * One front door over four asset lanes (NFTs, services, tokens, agents) means one
 * listing abstraction — but the lanes are categorically different transactions, so
 * UnifiedListing is a DISCRIMINATED UNION keyed on `assetType`, not a flat shape
 * that pretends a freelance milestone and an NFT price are the same field (panel
 * finding H2/H3). The shell shares chrome, discovery, identity and the fee-row
 * convention; each lane keeps its own trade panel driven by its variant here.
 *
 * @module lib/marketplace/types
 */

/** The four marketplace lanes. v1 ships nft + service; token + agent are roadmap. */
export type AssetType = "nft" | "service" | "token" | "agent"

/** Fields every lane shares — discovery card chrome + provenance + the fee row. */
export interface BaseListing {
    assetType: AssetType
    /** Engine-scoped stable id (e.g. "creator/slug/tokenId" for nft). */
    id: string
    title: string
    /** Display image / icon source; empty string when the lane has none. */
    image?: string
    /** Team-curated trust badge (never a gate). */
    verified: boolean
    /**
     * Seller / provider address — FULL bech32, never the realm's truncated render
     * value. Trade-critical paths must use this, not a `truncAddr`'d display string.
     */
    seller: string
    /**
     * Protocol fee in basis points for this lane, read from memba_market_config
     * (never hardcoded). The UI fee row renders from this so it can't drift from the
     * on-chain rate.
     */
    feeBps: number
    /** Where the data came from — chain (qeval) or the backend indexer/API. */
    source: "chain" | "backend"
    /** The engine this listing trades on (path + address). */
    engine: { path: string; addr: string }
}

export type NftAction = "buy" | "offer" | "list" | "delist"
export interface UnifiedNft extends BaseListing {
    assetType: "nft"
    /** Unit price (one token). */
    price: { amount: bigint; denom: "ugnot" }
    /** Creator royalty in bps (nft-only; paid on top of the protocol fee). */
    royaltyBps: number
    actions: NftAction[]
}

export type ServiceAction = "hire" | "fund" | "release" | "dispute"
export interface UnifiedService extends BaseListing {
    assetType: "service"
    /** Milestone-funded escrow — NOT a single unit price (panel H3). */
    milestones: { title: string; amount: bigint }[]
    actions: ServiceAction[]
}

export type TokenAction = "fill" | "list"
export interface UnifiedToken extends BaseListing {
    assetType: "token"
    /** OTC ask per token unit. */
    unitPrice: bigint
    /** Remaining amount available to fill. */
    available: bigint
    actions: TokenAction[]
}

export type AgentAction = "subscribe" | "topup"
export interface UnifiedAgent extends BaseListing {
    assetType: "agent"
    /** Price per call (credit deposit settles on-chain). */
    perCall: bigint
    actions: AgentAction[]
}

/** The discriminated union the shell renders and the router dispatches on. */
export type UnifiedListing = UnifiedNft | UnifiedService | UnifiedToken | UnifiedAgent

// ── Type guards — narrow a UnifiedListing to its lane variant ──────────────────
export const isNftListing = (l: UnifiedListing): l is UnifiedNft => l.assetType === "nft"
export const isServiceListing = (l: UnifiedListing): l is UnifiedService => l.assetType === "service"
export const isTokenListing = (l: UnifiedListing): l is UnifiedToken => l.assetType === "token"
export const isAgentListing = (l: UnifiedListing): l is UnifiedAgent => l.assetType === "agent"

// ── CardModel — the single presentation shape every lane renders through ────────
/**
 * The lane-agnostic view model consumed by the ONE `<MarketCard>` (marketplace-v2
 * Phase 1). Per-lane pure adapters (`nftToCard`/`serviceToCard`/… — Phase 2) map a
 * `UnifiedListing` into this, so the card never branches on `assetType`.
 *
 * TRUST INVARIANT: `verified` and `reputation` here must be populated ONLY from the
 * authoritative curation / reviews realms keyed by `seller.address` — never from
 * seller-controlled listing metadata (prevents forged badges / fake reputation).
 */
export interface CardReputation {
    /** Average rating (verified-purchase reviews only). */
    rating: number
    /** Number of verified-purchase reviews backing the rating. */
    count: number
    /** Seller level label (e.g. "New", "Level 2", "Top Rated"). */
    level: string
}

export interface CardStat {
    label: string
    value: string
    /** Render the value in the monospace/data face (amounts, ids) — default false. */
    mono?: boolean
}

export interface CardMedia {
    /** `art` = a real image at `src`; `monogram` = deterministic gradient tile from `seed`. */
    kind: "art" | "monogram"
    src?: string
    seed?: string
}

export interface CardModel {
    id: string
    lane: AssetType
    title: string
    /** Taxonomy category (for browse-by-category chips); optional. */
    category?: string
    /** Numeric price for sorting/filtering (GNOT). Distinct from the display `priceLabel`. */
    priceValue?: number
    media: CardMedia
    /** Authoritative curation flag — see TRUST INVARIANT above. */
    verified: boolean
    seller: {
        handle: string
        /** FULL bech32 address (shown for copymint/impersonation defense). */
        address: string
        /** Authoritative reputation, or null for a new/unrated seller. */
        reputation?: CardReputation | null
    }
    /** Compact stat row (e.g. Floor / Volume, Starting-at, Available@price). */
    stats: CardStat[]
    /** Headline price label already formatted for display (e.g. "12 GNOT"). */
    priceLabel: string
    /** Destination for the whole-card link (detail page). */
    href: string
    /** Optional primary action rendered as a button on the card. */
    action?: { label: string; onClick?: () => void }
}
