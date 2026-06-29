import { Suspense, lazy } from "react"
import { Routes, Route, Navigate, NavLink, Link, useLocation, useSearchParams } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"

// Lazy-load the lane components so the shell stays light
const NftLane = lazy(() => import("../components/marketplace/NftLane"))
const ServiceLane = lazy(() => import("../components/marketplace/ServiceLane"))
const AgentLane = lazy(() => import("../components/marketplace/AgentLane"))

import "./unified-marketplace.css"

export default function UnifiedMarketplace() {
    const np = useNetworkPath()
    const { pathname } = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()

    // Active path logic to style the header dynamically if desired
    const isServices = pathname.includes("/services")
    const isAgents = pathname.includes("/agents")

    return (
        <div className="um-container animate-fade-in">
            {/* ── Premium Hero Header ─────────────────────────── */}
            <header className={`um-hero ${isServices ? "um-hero-services" : isAgents ? "um-hero-agents" : "um-hero-nfts"}`}>
                <div className="um-hero-content">
                    <h1 className="um-hero-title">
                        {isServices ? "Freelance Services" : isAgents ? "AI Agents" : "Digital Assets"}
                    </h1>
                    <p className="um-hero-subtitle">
                        {isServices 
                            ? "Hire world-class talent with on-chain milestone escrow." 
                            : isAgents 
                            ? "Deploy autonomous agents to power your decentralized applications." 
                            : "Discover, buy, and sell verified digital collectibles and art."}
                    </p>
                    
                    {/* Primary call to action per lane */}
                    <div className="um-hero-actions">
                        {!isServices && !isAgents && (
                            <Link to={np("nft/create")} className="k-btn-primary">
                                Sell an Asset
                            </Link>
                        )}
                        {isServices && (
                            <button className="k-btn-primary" onClick={() => alert("Service creation coming soon.")}>
                                Offer a Service
                            </button>
                        )}
                        {isAgents && (
                            <button className="k-btn-primary" onClick={() => alert("Agent deployment coming soon.")}>
                                Deploy an Agent
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* ── Unified Navigation Tabs & Search ──────────────── */}
            <div className="um-nav-container">
                <nav className="um-tabs" role="tablist">
                    <NavLink to="nfts" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">🖼️</span> NFTs & Art
                    </NavLink>
                    <NavLink to="services" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
                        <span className="um-tab-icon">💼</span> Services
                    </NavLink>
                    <NavLink to="agents" className={({ isActive }) => `um-tab ${isActive ? "active" : ""}`}>
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
                        <Route path="agents" element={<AgentLane />} />
                    </Routes>
                </Suspense>
            </main>
        </div>
    )
}
