import { Suspense, lazy, type ComponentType } from "react"
import { Routes, Route, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { getLiveLanes, getDefaultLaneSlug } from "../lib/marketplace/lanes"
import { useAdena } from "../hooks/useAdena"
import type { AssetType } from "../lib/marketplace/types"

// Lazy-load the lane components so the shell stays light
const NftLane = lazy(() => import("../components/marketplace/NftLane"))
const ServiceLane = lazy(() => import("../components/marketplace/ServiceLane"))
const AgentLane = lazy(() => import("../components/marketplace/AgentLane"))
const TokenLane = lazy(() => import("./TokenLane").then(m => ({ default: m.TokenLane })))
const MyListingsView = lazy(() => import("../components/marketplace/MyListingsView"))

// The "My Listings" management surface is a fixed sub-route (not a lane): it
// aggregates the connected wallet's own listings across the live lanes.
const MY_LISTINGS_SLUG = "my-listings"

// The lanes whose listings My Listings can manage (read + cancel). Derived from
// the live-lane set so the shell doesn't pull the heavy listing readers into
// its own import graph.
const MANAGED_LANES: readonly AssetType[] = ["nft", "token"]

import "./unified-marketplace.css"

// assetType → the lane's UI. A lane only appears in the shell when getLiveLanes()
// says it is live (flag + backing realm both valid on the active network), so a
// gated lane is unreachable via both its tab and a direct URL (W0.1).
const LANE_COMPONENTS: Record<AssetType, ComponentType> = {
    nft: NftLane,
    service: ServiceLane,
    token: TokenLane,
    agent: AgentLane,
}

const LANE_TAB_ICONS: Record<AssetType, string> = {
    nft: "🖼️",
    service: "💼",
    token: "🪙",
    agent: "🤖",
}

// Per-lane hero copy + trust chips. The marketplace is one shell; each lane gets
// its own terminal-header title, subtitle, and a short row of true on-chain
// guarantees (no fabricated metrics). laneKey mirrors the hero accent class.
const HERO_META: Record<string, { title: string; subtitle: string; chips: string[] }> = {
    nfts: {
        title: "Digital Assets",
        subtitle: "Discover, buy, and sell verified collectibles and art — provenance and creator royalties enforced on-chain.",
        chips: ["Creator royalties enforced", "On-chain provenance", "Self-custody"],
    },
    services: {
        title: "Freelance Services",
        subtitle: "Hire talent with milestone escrow settled on-chain — funds release only when work is accepted.",
        chips: ["Milestone escrow", "On-chain dispute freeze", "Fees fund the DAO"],
    },
    agents: {
        title: "AI Agents",
        subtitle: "Deploy autonomous agents to power your decentralized applications, registered on-chain.",
        chips: ["Autonomous", "On-chain registry"],
    },
    tokens: {
        title: "Tokens",
        subtitle: "Trade tokens peer-to-peer through the on-chain OTC engine — atomic settlement, no custody.",
        chips: ["Atomic OTC settlement", "No custody", "Fees fund the DAO"],
    },
}

export default function UnifiedMarketplace() {
    const { pathname } = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const { connected } = useAdena()

    // Single source of truth: only lanes that are live on this network render.
    const liveLanes = getLiveLanes()

    // Show the "My Listings" tab only to a connected wallet with a live lane to
    // manage. The route itself stays mounted (it renders a connect prompt when
    // disconnected) so a shared/bookmarked URL still works.
    const canManageListings = liveLanes.some(l => MANAGED_LANES.includes(l.assetType))
    const showMyListings = connected && canManageListings

    // No live lane on this network → nothing to trade; don't render a shell full of
    // dead tabs (and never leave a route reachable that a gated lane would answer).
    if (liveLanes.length === 0) {
        return (
            <div className="um-container animate-fade-in">
                <div className="um-empty" role="status">
                    The marketplace is not available on this network yet.
                </div>
            </div>
        )
    }

    const defaultSlug = getDefaultLaneSlug() ?? liveLanes[0].slug

    // Absolute path to the default lane. The catch-all redirect below lives INSIDE the
    // splat <Route path="*">, so a relative <Navigate to={defaultSlug}> would resolve
    // against the growing matched splat (/marketplace/tokens → …/tokens/nfts → …/nfts/nfts)
    // and loop forever. Anchoring to the marketplace mount root keeps a gated/unknown lane
    // URL a single clean redirect to the live lane (W0.1).
    const marketplaceBase = pathname.slice(0, pathname.indexOf("/marketplace") + "/marketplace".length)
    const defaultLanePath = `${marketplaceBase}/${defaultSlug}`

    // Active lane drives the hero copy + accent (one shell, per-lane header).
    const laneKey = pathname.includes("/services") ? "services"
        : pathname.includes("/agents") ? "agents"
        : pathname.includes("/tokens") ? "tokens"
        : "nfts"
    const hero = HERO_META[laneKey]

    return (
        <div className="um-container animate-fade-in">
            {/* ── Hero: on-chain market terminal header ───────────── */}
            <header className={`um-hero um-hero--${laneKey}`}>
                <div className="um-hero__bg" aria-hidden="true" />
                <div className="um-hero-content">
                    <div className="um-hero__eyebrow">
                        <span className="um-hero__pulse" aria-hidden="true" />
                        Live on gno.land
                    </div>
                    <h1 className="um-hero-title">{hero.title}</h1>
                    <p className="um-hero-subtitle">{hero.subtitle}</p>
                    <ul className="um-hero__chips">
                        {hero.chips.map((c) => (
                            <li key={c} className="um-hero__chip">{c}</li>
                        ))}
                    </ul>
                </div>
            </header>

            {/* ── Navigation Tabs (live lanes only) & Search ────── */}
            <div className="um-nav-container">
                <nav className="um-tabs" role="tablist">
                    {liveLanes.map((lane) => (
                        <NavLink
                            key={lane.assetType}
                            role="tab"
                            to={lane.slug}
                            className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}
                        >
                            <span className="um-tab-icon">{LANE_TAB_ICONS[lane.assetType]}</span> {lane.label}
                        </NavLink>
                    ))}
                    {showMyListings && (
                        <NavLink
                            role="tab"
                            to={MY_LISTINGS_SLUG}
                            className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}
                            data-testid="my-listings-tab"
                        >
                            <span className="um-tab-icon">🏷️</span> My Listings
                        </NavLink>
                    )}
                </nav>
                <div className="um-search">
                    <input
                        type="search"
                        placeholder="Search marketplace..."
                        defaultValue={searchParams.get("q") || ""}
                        onChange={(e) => {
                            if (e.target.value) {
                                setSearchParams({ q: e.target.value })
                            } else {
                                setSearchParams({})
                            }
                        }}
                    />
                </div>
            </div>

            {/* ── Lane Content (routes for live lanes only) ─────── */}
            <main className="um-main">
                <Suspense fallback={<ConnectingLoader minHeight="40vh" />}>
                    <Routes>
                        <Route path="/" element={<Navigate to={defaultLanePath} replace />} />
                        {liveLanes.map((lane) => {
                            const LaneComponent = LANE_COMPONENTS[lane.assetType]
                            return <Route key={lane.assetType} path={lane.slug} element={<LaneComponent />} />
                        })}
                        {/* My Listings management — mounts whenever a lane it manages is live
                            (the view itself prompts to connect when disconnected). */}
                        {canManageListings && (
                            <Route path={MY_LISTINGS_SLUG} element={<MyListingsView />} />
                        )}
                        {/* Gate everything else — a gated/unknown lane URL redirects to a live lane. */}
                        <Route path="*" element={<Navigate to={defaultLanePath} replace />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    )
}
