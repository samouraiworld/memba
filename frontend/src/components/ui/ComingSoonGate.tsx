/**
 * ComingSoonGate — Full-page gate for unreleased features.
 *
 * Displays a labelled, inert design preview, feature outline,
 * and optional estimated release date. Used to gate aspirational routes
 * (Marketplace, NFT, Services, Teams) behind feature flags.
 *
 * @module components/ui/ComingSoonGate
 */

import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { ArrowLeft, ArrowUpRight, SquaresFour } from "@phosphor-icons/react"
import "./coming-soon.css"

interface ComingSoonGateProps {
    /** Feature title, e.g. "AI Agent Marketplace" */
    title: string
    /** Emoji icon, e.g. "🤖" */
    icon: string
    /** 1-2 sentence description of the feature */
    description: string
    /** Bullet list of planned capabilities */
    features: string[]
    /** Override the generic badge when a feature is disabled or unavailable. */
    statusLabel?: string
    /** Optional estimated release, e.g. "Q3 2026" */
    estimatedRelease?: string
    preview?: "marketplace" | "workspace" | "reputation" | "game" | "feed"
}

export function ComingSoonGate({
    title,
    icon,
    description,
    features,
    statusLabel = "Coming soon",
    estimatedRelease,
    preview = "workspace",
}: ComingSoonGateProps) {
    const nk = useNetworkKey()

    return (
        <div className="coming-soon-gate" data-testid="coming-soon-gate">
            <header className="coming-soon-card">
                <div className="coming-soon-icon" aria-hidden="true">{icon}</div>
                <span className="coming-soon-badge">{statusLabel}</span>
                <h1 className="coming-soon-title">{title}</h1>
                <p className="coming-soon-desc">{description}</p>

                {features.length > 0 && (
                    <ul className="coming-soon-features">
                        {features.map((feature, i) => (
                            <li key={i}>{feature}</li>
                        ))}
                    </ul>
                )}

                <Link to={`/${nk}/`} className="coming-soon-cta">
                    <ArrowLeft size={14} />
                    Back to Home
                </Link>

                {estimatedRelease && (
                    <p className="coming-soon-eta">
                        Estimated availability: {estimatedRelease}
                    </p>
                )}
            </header>
            <figure className={`soon-preview soon-preview--${preview}`} aria-label={`${title} design preview`}>
                <figcaption><span>Design preview</span><span>Illustrative · not live</span></figcaption>
                {/* Static elements only: this never mounts the gated feature, queries data,
                    connects a wallet, or provides working transaction controls. */}
                <div className="soon-preview__canvas" aria-hidden="true">
                    <div className="soon-preview__top"><SquaresFour size={20} /><strong>{title}</strong><span>Preview</span></div>
                    {preview === "marketplace" ? <>
                        <div className="soon-preview__intro"><span>Discover something original</span><p>A home for independent creators.</p></div>
                        <div className="soon-preview__tabs"><span>Collectibles</span><span>Services</span><span>Tokens</span></div>
                        <div className="soon-preview__collection">
                            {["Fold studies", "Community editions", "Creative services"].map((name, index) => <div className="soon-preview__tile" key={name}>
                                <div className={`soon-preview__art soon-preview__art--${index}`}><i /><i /><i /></div>
                                <strong>{name}</strong><span>Sample collection <ArrowUpRight size={14} /></span>
                            </div>)}
                        </div>
                    </> : preview === "reputation" ? <>
                        <div className="soon-preview__intro"><span>Contributions that count</span><p>Your activity. Your community. Your reputation.</p></div>
                        <div className="soon-preview__stats"><div><span>Your reputation</span><strong>— MP</strong></div><div><span>Community rank</span><strong>—</strong></div></div>
                        {["Governance participation", "Community contributions", "Milestones"].map(name => <div className="soon-preview__row" key={name}><span>{name}</span><span>Planned</span></div>)}
                    </> : preview === "game" ? <>
                        <div className="soon-preview__intro"><span>A new way to play</span><p>Built for your community. Powered by Gno.</p></div>
                        <div className="soon-preview__game">{Array.from({ length: 48 }, (_, i) => <i key={i} className={[9, 10, 17, 18, 26, 34, 35, 36, 38, 43, 44, 45, 46].includes(i) ? "filled" : ""} />)}</div>
                    </> : preview === "feed" ? <>
                        <div className="soon-preview__intro"><span>A conversation worth joining</span><p>Ideas and updates from across your community.</p></div>
                        {["Share what you’re building", "Discuss a proposal", "Stay close to your community"].map(name => <div className="soon-preview__post" key={name}><span>Community member · Sample post</span><strong>{name}</strong><div /><div /></div>)}
                    </> : <>
                        <div className="soon-preview__intro"><span>Your next workspace</span><p>Everything you need, brought together.</p></div>
                        <div className="soon-preview__stats"><div><span>Overview</span><strong>{title}</strong></div><div><span>Activity</span><strong>—</strong></div></div>
                        {features.slice(0, 3).map(feature => <div className="soon-preview__row" key={feature}><span>{feature}</span><ArrowUpRight size={16} /></div>)}
                    </>}
                    <div className="soon-preview__footer">Illustrative preview</div>
                </div>
                <p className="soon-preview__note">This feature is not available here. The preview is illustrative and does not show live controls.</p>
            </figure>
        </div>
    )
}
