import { Suspense, lazy } from "react"
import { Routes, Route, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"

// Lazy-load the lane components so the shell stays light
const NftLane = lazy(() => import("../components/marketplace/NftLane"))
const ServiceLane = lazy(() => import("../components/marketplace/ServiceLane"))
const AgentLane = lazy(() => import("../components/marketplace/AgentLane"))
const TokenLane = lazy(() => import("./TokenLane").then(m => ({ default: m.TokenLane })))

import "./unified-marketplace.css"

export default function UnifiedMarketplace() {
    const { pathname } = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()

    // Active path logic to style the header dynamically if desired
    const isServices = pathname.includes("/services")
    const isAgents = pathname.includes("/agents")
    const isTokens = pathname.includes("/tokens")

    return (
        <div className="um-container animate-fade-in">
            {/* ── Premium Hero Header ─────────────────────────── */}
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
                    
                    <div className="um-hero-stats">
                        <div className="um-hero-stat-card">
                            <span className="um-stat-value">24.5k</span>
                            <span className="um-stat-label">24h Vol (GNOT)</span>
                        </div>
                        <div className="um-hero-stat-card">
                            <span className="um-stat-value">1,402</span>
                            <span className="um-stat-label">Active Listings</span>
                        </div>
                        <div className="um-hero-stat-card">
                            <span className="um-stat-value">Top</span>
                            <span className="um-stat-label">Samourai Crew</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* ── Unified Navigation Tabs & Search ──────────────── */}
            <div className="um-nav-container">
                <nav className="um-tabs" role="tablist">
                    <NavLink role="tab" to="nfts" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">🖼️</span> NFTs & Art
                    </NavLink>
                    <NavLink role="tab" to="services" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">💼</span> Services
                    </NavLink>
                    <NavLink role="tab" to="tokens" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">🪙</span> Tokens
                    </NavLink>
                    <NavLink role="tab" to="agents" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">🤖</span> AI Agents
                    </NavLink>
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

            {/* ── Lane Content ─────────────────────────────────── */}
            <main className="um-main">
                <Suspense fallback={<ConnectingLoader minHeight="40vh" />}>
                    <Routes>
                        <Route path="/" element={<Navigate to="nfts" replace />} />
                        <Route path="nfts" element={<NftLane />} />
                        <Route path="services" element={<ServiceLane />} />
                        <Route path="tokens" element={<TokenLane />} />
                        <Route path="agents" element={<AgentLane />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    )
}
