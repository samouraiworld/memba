import { Suspense, lazy, type ComponentType } from "react"
import { Routes, Route, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { getLiveLanes, getDefaultLaneSlug } from "../lib/marketplace/lanes"
import type { AssetType } from "../lib/marketplace/types"

// Lazy-load the lane components so the shell stays light
const NftLane = lazy(() => import("../components/marketplace/NftLane"))
const ServiceLane = lazy(() => import("../components/marketplace/ServiceLane"))
const AgentLane = lazy(() => import("../components/marketplace/AgentLane"))
const TokenLane = lazy(() => import("./TokenLane").then(m => ({ default: m.TokenLane })))

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

export default function UnifiedMarketplace() {
    const { pathname } = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()

    // Single source of truth: only lanes that are live on this network render.
    const liveLanes = getLiveLanes()

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

    // Active path logic to style the header dynamically.
    const isServices = pathname.includes("/services")
    const isAgents = pathname.includes("/agents")
    const isTokens = pathname.includes("/tokens")

    return (
        <div className="um-container animate-fade-in">
            {/* ── Hero Header ─────────────────────────────────── */}
            <header className={`um-hero ${isServices ? "um-hero-services" : isAgents ? "um-hero-agents" : "um-hero-nfts"}`}>
                <div className="um-hero-content">
                    <h1 className="um-hero-title">
                        {isServices ? "Freelance Services" : isAgents ? "AI Agents" : isTokens ? "Tokens" : "Digital Assets"}
                    </h1>
                    <p className="um-hero-subtitle">
                        {isServices
                            ? "Hire world-class talent with on-chain milestone escrow."
                            : isAgents
                            ? "Deploy autonomous agents to power your decentralized applications."
                            : isTokens
                            ? "Trade OTC tokens securely via the on-chain engine."
                            : "Discover, buy, and sell verified digital collectibles and art."}
                    </p>
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
                        <Route path="/" element={<Navigate to={defaultSlug} replace />} />
                        {liveLanes.map((lane) => {
                            const LaneComponent = LANE_COMPONENTS[lane.assetType]
                            return <Route key={lane.assetType} path={lane.slug} element={<LaneComponent />} />
                        })}
                        {/* Gate everything else — a gated/unknown lane URL redirects to a live lane. */}
                        <Route path="*" element={<Navigate to={defaultSlug} replace />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    )
}
