/**
 * Landing — Non-connected home page with animated feature showcase.
 *
 * Showcases Memba's real capabilities using Remotion <Player> embeds.
 * Connected users are redirected to /dashboard (unchanged behavior).
 *
 * @see implementation_plan.md for full architecture rationale
 */
import { useOutletContext, Navigate } from "react-router-dom"
import { useNetworkNav, useNetworkKey } from "../hooks/useNetworkNav"
import { useEffect, useRef, useCallback, useState } from "react"
import { Player } from "@remotion/player"
import type { LayoutContext } from "../types/layout"
import { NetworkStatsLive } from "../components/landing/NetworkStatsLive"
import { fetchTractionMetrics, type TractionMetrics } from "../lib/traction"
import "./landing.css"

// ── Composition imports (tree-shaken, code-split via lazy page) ────────
import { MultisigFlow } from "../remotion/compositions/MultisigFlow"
import { DAOGovernance } from "../remotion/compositions/DAOGovernance"
import { TokenFactory } from "../remotion/compositions/TokenFactory"
import { VoiceChannel } from "../remotion/compositions/VoiceChannel"
import { ValidatorDash } from "../remotion/compositions/ValidatorDash"
import { CommandPalette as CmdKComp } from "../remotion/compositions/CommandPalette"

// ── Feature card definitions (fact-based from README) ──────────────────
const FEATURES = [
    {
        id: "multisig",
        icon: "🔐",
        title: "Multisig Wallets",
        desc: "Create shared wallets with K-of-N threshold signing. Air-gapped gnokey support for maximum security.",
        href: "/multisig",
        Comp: MultisigFlow,
        durationInFrames: 300,
    },
    {
        id: "dao",
        icon: "🏛️",
        title: "DAO Governance",
        desc: "Browse & vote on DAO proposals. Create your own DAO with custom roles, tiers, and treasury management.",
        href: "/dao",
        Comp: DAOGovernance,
        durationInFrames: 300,
    },
    {
        id: "token",
        icon: "🪙",
        title: "Token Factory",
        desc: "Deploy GRC20 tokens on gno.land. Configure supply, decimals, and multisig-governed administration.",
        href: "/tokens",
        Comp: TokenFactory,
        durationInFrames: 300,
    },
    {
        id: "channels",
        icon: "🔊",
        title: "Live Rooms",
        desc: "Voice & video channels with Jitsi Meet integration. Persistent PiP mode across routes.",
        href: "/dao",
        Comp: VoiceChannel,
        durationInFrames: 240,
    },
    {
        id: "validators",
        icon: "📊",
        title: "Validator Dashboard",
        desc: "Monitor network validators, voting power distribution, and real-time consensus metrics.",
        href: "/validators",
        Comp: ValidatorDash,
        durationInFrames: 240,
    },
    {
        id: "cmdk",
        icon: "⌘",
        title: "Command Palette",
        desc: "Navigate instantly with ⌘K. Fuzzy search across 14+ commands with keyboard shortcuts.",
        href: "/",
        Comp: CmdKComp,
        durationInFrames: 180,
    },
] as const

// ── Tech badges (all real, from README + package.json) ─────────────────
const TECH_BADGES = [
    { label: "React 19", accent: false },
    { label: "Vite 7", accent: false },
    { label: "Go 1.25+", accent: false },
    { label: "ConnectRPC", accent: false },
    { label: "gno.land", accent: true },
    { label: "MIT License", accent: false },
    { label: "1249+ Unit Tests", accent: true },
    { label: "73 Backend Tests", accent: true },
]

// ── Hook: IntersectionObserver for scroll-triggered fade-in ────────────
function useFadeOnScroll() {
    const refs = useRef<(HTMLElement | null)[]>([])

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("visible")
                    }
                })
            },
            { threshold: 0.15 }
        )
        refs.current.forEach(el => el && observer.observe(el))
        return () => observer.disconnect()
    }, [])

    const setRef = useCallback((i: number) => (el: HTMLElement | null) => {
        refs.current[i] = el
    }, [])

    return setRef
}

// ── Remotion Player Wrapper (handles prefers-reduced-motion) ───────────
function FeaturePlayer({ Comp, durationInFrames }: { Comp: React.FC; durationInFrames: number }) {
    const [prefersReduced, setPrefersReduced] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )

    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
        mq.addEventListener("change", handler)
        return () => mq.removeEventListener("change", handler)
    }, [])

    if (prefersReduced) {
        // Static fallback: render component without animation frames
        return (
            <div style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
                <Comp />
            </div>
        )
    }

    return (
        <Player
            component={Comp}
            durationInFrames={durationInFrames}
            compositionWidth={480}
            compositionHeight={300}
            fps={30}
            loop
            autoPlay
            acknowledgeRemotionLicense
            style={{ width: "100%", height: "100%" }}
            controls={false}
        />
    )
}

// ══════════════════════════════════════════════════════════════════════════
// LANDING COMPONENT
// ══════════════════════════════════════════════════════════════════════════
export function Landing() {
    const navigate = useNetworkNav()
    const networkKey = useNetworkKey()
    const { adena } = useOutletContext<LayoutContext>()
    const setRef = useFadeOnScroll()
    const [traction, setTraction] = useState<TractionMetrics | null>(null)

    useEffect(() => {
        fetchTractionMetrics().then(setTraction).catch(() => {})
    }, [])

    // N1: Redirect connected users to Dashboard
    if (adena.connected) {
        return <Navigate to={`/${networkKey}/dashboard`} replace />
    }

    const handleCTA = () => {
        if (adena.installed) {
            adena.connect()
        } else {
            window.open("https://adena.app", "_blank", "noopener,noreferrer")
        }
    }

    return (
        <div className="landing animate-fade-in">
            {/* ── Hero Section ──────────────────────────────────── */}
            <section className="landing-hero">
                <h1 className="landing-hero__title">
                    <span>The DAO Operating System</span>
                    <span className="landing-hero__jp">メンバー</span>
                </h1>
                <p className="landing-hero__subtitle">
                    Your gateway to Gno multisig wallets, DAO governance,
                    and token management — all in one place.
                </p>

                <div className="landing-cta-group">
                    <button className="landing-cta-primary" onClick={handleCTA}>
                        {adena.installed
                            ? "Connect Wallet →"
                            : "Install Adena Wallet →"}
                    </button>
                    <a href="#features" className="landing-cta-scroll">
                        Explore Features ↓
                    </a>
                </div>

                <div className="landing-network-badge">
                    <div className="landing-network-badge__dot" />
                    Live on <a href="https://gno.land" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>gno.land</a> — the smart contract platform
                </div>
            </section>

            {/* ── Feature Showcase ──────────────────────────────── */}
            <section id="features" ref={setRef(0)} className="landing-fade-section">
                <div className="landing-section-header">
                    <h2 className="landing-section-header__title">What You Can Do</h2>
                    <p className="landing-section-header__subtitle">Real features, real UI — see Memba in action</p>
                </div>
                <div className="landing-features">
                    {FEATURES.map(f => (
                        <div
                            key={f.id}
                            className="landing-feature-card"
                            onClick={() => navigate(f.href)}
                        >
                            <div className="landing-feature-card__player">
                                <FeaturePlayer Comp={f.Comp} durationInFrames={f.durationInFrames} />
                            </div>
                            <div className="landing-feature-card__body">
                                <div className="landing-feature-card__title">
                                    <span className="landing-feature-card__title-icon">{f.icon}</span>
                                    {f.title}
                                </div>
                                <p className="landing-feature-card__desc">{f.desc}</p>
                                <span className="landing-feature-card__link">
                                    Explore →
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Live Network Stats ──────────────────────────────── */}
            <section ref={setRef(1)} className="landing-fade-section">
                <div className="landing-section-header">
                    <h2 className="landing-section-header__title">Live Network</h2>
                    <p className="landing-section-header__subtitle">Real-time on-chain data from gno.land</p>
                </div>
                <NetworkStatsLive />
            </section>

            {/* ── Ecosystem Metrics ─────────────────────────────── */}
            {traction && (traction.contributorCount > 0 || traction.repoCount > 0) && (
                <section ref={setRef(2)} className="landing-fade-section">
                    <div className="landing-section-header">
                        <h2 className="landing-section-header__title">Ecosystem Traction</h2>
                        <p className="landing-section-header__subtitle">Live metrics from the Gno ecosystem</p>
                    </div>
                    <div className="landing-traction">
                        <div className="landing-traction__card">
                            <span className="landing-traction__value">{traction.daoCount}</span>
                            <span className="landing-traction__label">Deployed Realms</span>
                        </div>
                        {traction.contributorCount > 0 && (
                            <div className="landing-traction__card">
                                <span className="landing-traction__value">{traction.contributorCount}</span>
                                <span className="landing-traction__label">Contributors</span>
                            </div>
                        )}
                        {traction.repoCount > 0 && (
                            <div className="landing-traction__card">
                                <span className="landing-traction__value">{traction.repoCount}</span>
                                <span className="landing-traction__label">Tracked Repos</span>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* ── Tech + Open Source ────────────────────────────── */}
            <section ref={setRef(2)} className="landing-fade-section landing-tech">
                <div className="landing-section-header">
                    <h2 className="landing-section-header__title">Built for the Gno Ecosystem</h2>
                    <p className="landing-section-header__subtitle">Open-source, MIT licensed, production-grade</p>
                </div>

                <div className="landing-tech__badges">
                    {TECH_BADGES.map(b => (
                        <span
                            key={b.label}
                            className={`landing-tech__badge${b.accent ? " landing-tech__badge--accent" : ""}`}
                        >
                            {b.label}
                        </span>
                    ))}
                </div>

                <div className="landing-tech__links">
                    <a
                        href="https://github.com/samouraiworld/memba"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="landing-tech__link"
                    >
                        ⭐ GitHub Repository
                    </a>
                    <a
                        href="https://gno.land"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="landing-tech__link"
                    >
                        🌐 gno.land Blockchain
                    </a>
                    <a
                        href="https://www.samourai.world"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="landing-tech__link"
                    >
                        🏴‍☠️ Built by Samouraï Coop
                    </a>
                </div>
            </section>

            {/* ── Final CTA ────────────────────────────────────── */}
            <section ref={setRef(3)} className="landing-fade-section landing-final-cta">
                <h2 className="landing-section-header__title">
                    Ready to explore?
                </h2>
                <button className="landing-cta-primary" onClick={handleCTA}>
                    {adena.installed
                        ? "Connect your Adena wallet →"
                        : "Install Adena wallet to get started →"}
                </button>

                {!adena.installed && (
                    <details className="landing-adena-info">
                        <summary>What is Adena? ↓</summary>
                        <div className="landing-adena-info__content">
                            <p>
                                <strong>Adena</strong> is a non-custodial browser extension wallet
                                for the gno.land blockchain — similar to MetaMask for Ethereum.
                            </p>
                            <p>
                                It securely manages your private keys locally. Memba never accesses
                                your private keys — only your public address is used for authentication
                                via ADR-036 challenge-response signing.
                            </p>
                            <p>
                                <a href="https://adena.app" target="_blank" rel="noopener noreferrer">
                                    Install Adena →
                                </a>
                            </p>
                        </div>
                    </details>
                )}
            </section>
        </div>
    )
}
