import { Suspense, lazy, useEffect, useState, type ComponentType, type KeyboardEvent } from "react"
import { Routes, Route, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { getLiveLanes, getDefaultLaneSlug } from "../lib/marketplace/lanes"
import { useAdena } from "../hooks/useAdena"
import { isMarketplaceV2Enabled } from "../lib/config"
import { fetchCollectionList } from "../lib/launchpadReads"
import { Image, Briefcase, Coins, Robot, Tag, type Icon } from "@phosphor-icons/react"
import type { AssetType } from "../lib/marketplace/types"

// Lazy-load the lane components so the shell stays light
const NftLane = lazy(() => import("../components/marketplace/NftLane"))
const ServiceLane = lazy(() => import("../components/marketplace/ServiceLane"))
const AgentLane = lazy(() => import("../components/marketplace/AgentLane"))
const TokenLane = lazy(() => import("./TokenLane").then(m => ({ default: m.TokenLane })))
const MyListingsView = lazy(() => import("../components/marketplace/MyListingsView"))

// marketplace-v2 lanes (rebuilt on LaneView/MarketCard). Behind VITE_ENABLE_MARKETPLACE_V2
// so the old lanes stay the prod default until the flag flips at cutover.
const NftLaneV2 = lazy(() => import("../components/marketplace/NftLaneV2"))
const ServiceLaneV2 = lazy(() => import("../components/marketplace/ServiceLaneV2"))
const TokenLaneV2 = lazy(() => import("../components/marketplace/TokenLaneV2"))

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
const LANE_COMPONENTS: Record<AssetType, ComponentType> = isMarketplaceV2Enabled()
    ? {
          nft: NftLaneV2,
          service: ServiceLaneV2,
          token: TokenLaneV2,
          agent: AgentLane, // no v2 agent lane yet — Agents stays on the current component
      }
    : {
          nft: NftLane,
          service: ServiceLane,
          token: TokenLane,
          agent: AgentLane,
      }

// WAI-ARIA tabs keyboard pattern (roving tabindex): Left/Right move focus
// between tabs (wrapping), Home/End jump to the edges. Activation stays on
// Enter/Space — these tabs are router links, so focus alone must not navigate.
function onTablistKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
    const current = tabs.indexOf(document.activeElement as HTMLElement)
    if (current === -1) return
    e.preventDefault()
    const next =
        e.key === "Home" ? 0
        : e.key === "End" ? tabs.length - 1
        : e.key === "ArrowRight" ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length
    tabs[next].focus()
}

const LANE_TAB_ICONS: Record<AssetType, Icon> = {
    nft: Image,
    service: Briefcase,
    token: Coins,
    agent: Robot,
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

    // Live "N collections" for the NFT hero eyebrow. The shell reads the raw
    // collection LIST (one lightweight render call — not the lane's per-collection
    // enriched read), gated to the active+live NFT lane. Fail-safe: any error, or a
    // non-NFT/absent lane, leaves the count null so the eyebrow just omits it.
    const isNftsLane = !(pathname.includes("/services") || pathname.includes("/agents") || pathname.includes("/tokens"))
    const nftLaneLive = liveLanes.some((l) => l.assetType === "nft")
    const [nftCount, setNftCount] = useState<number | null>(null)
    useEffect(() => {
        if (!isNftsLane || !nftLaneLive) {
            setNftCount(null)
            return
        }
        let cancelled = false
        fetchCollectionList()
            .then((rows) => { if (!cancelled) setNftCount(rows.length) })
            .catch(() => { if (!cancelled) setNftCount(null) })
        return () => { cancelled = true }
    }, [isNftsLane, nftLaneLive])

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

    // Roving tabindex (WAI-ARIA tabs): exactly one tab is in the page tab order —
    // the selected one, or the first tab while the shell is mid-redirect and no
    // lane is selected yet (all -1 would make the tablist keyboard-unreachable).
    const activeSlug = pathname.endsWith(`/${MY_LISTINGS_SLUG}`)
        ? MY_LISTINGS_SLUG
        : liveLanes.find(l => pathname.endsWith(`/${l.slug}`))?.slug
    const rovingSlug =
        activeSlug && (activeSlug !== MY_LISTINGS_SLUG || showMyListings)
            ? activeSlug
            : liveLanes[0].slug

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
                        {laneKey === "nfts" && nftCount != null && nftCount > 0 && (
                            <span data-testid="hero-nft-count" style={{ opacity: 0.7 }}>
                                {nftCount} collection{nftCount === 1 ? "" : "s"}
                            </span>
                        )}
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
                <nav className="um-tabs" role="tablist" aria-label="Marketplace lanes" onKeyDown={onTablistKeyDown}>
                    {liveLanes.map((lane) => {
                        const LaneIcon = LANE_TAB_ICONS[lane.assetType]
                        return (
                            <NavLink
                                key={lane.assetType}
                                id={`um-tab-${lane.slug}`}
                                role="tab"
                                // Absolute on purpose: under react-router 7, a relative `to`
                                // inside this splat-mounted shell resolves against the full
                                // current URL (/marketplace/nfts + "services" → /nfts/services),
                                // which the catch-all bounces straight back — tabs never switch.
                                to={`${marketplaceBase}/${lane.slug}`}
                                aria-selected={pathname.endsWith(`/${lane.slug}`)}
                                aria-controls="um-lane-panel"
                                tabIndex={rovingSlug === lane.slug ? 0 : -1}
                                className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}
                            >
                                <span className="um-tab-icon" aria-hidden="true"><LaneIcon size={16} weight="bold" /></span> {lane.label}
                            </NavLink>
                        )
                    })}
                    {showMyListings && (
                        <NavLink
                            id={`um-tab-${MY_LISTINGS_SLUG}`}
                            role="tab"
                            to={`${marketplaceBase}/${MY_LISTINGS_SLUG}`}
                            aria-selected={pathname.endsWith(`/${MY_LISTINGS_SLUG}`)}
                            aria-controls="um-lane-panel"
                            tabIndex={rovingSlug === MY_LISTINGS_SLUG ? 0 : -1}
                            className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}
                            data-testid="my-listings-tab"
                        >
                            <span className="um-tab-icon" aria-hidden="true"><Tag size={16} weight="bold" /></span> My Listings
                        </NavLink>
                    )}
                </nav>
                {/* v2 lanes own their search via the LaneToolbar — hide the shell search
                    to avoid two boxes bound to the same ?q. */}
                {!isMarketplaceV2Enabled() && (
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
                )}
            </div>

            {/* ── Lane Content (routes for live lanes only) ─────── */}
            {/* One tabpanel for the whole route outlet: exactly one lane renders at
                a time, and every tab points here via aria-controls. */}
            <main
                className="um-main"
                role="tabpanel"
                id="um-lane-panel"
                aria-labelledby={activeSlug ? `um-tab-${activeSlug}` : undefined}
            >
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
