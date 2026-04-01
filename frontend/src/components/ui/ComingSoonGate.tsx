/**
 * ComingSoonGate — Full-page gate for unreleased features.
 *
 * Displays a glassmorphic card with animated icon, feature checklist,
 * and optional estimated release date. Used to gate aspirational routes
 * (Marketplace, NFT, Services, Teams) behind feature flags.
 *
 * @module components/ui/ComingSoonGate
 */

import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { ArrowLeft } from "@phosphor-icons/react"
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
    /** Optional estimated release, e.g. "Q3 2026" */
    estimatedRelease?: string
}

export function ComingSoonGate({
    title,
    icon,
    description,
    features,
    estimatedRelease,
}: ComingSoonGateProps) {
    const nk = useNetworkKey()

    return (
        <div className="coming-soon-gate" data-testid="coming-soon-gate">
            <div className="coming-soon-card">
                <div className="coming-soon-icon">{icon}</div>
                <h1 className="coming-soon-title">{title}</h1>
                <span className="coming-soon-badge">Coming Soon</span>
                <p className="coming-soon-desc">{description}</p>

                {features.length > 0 && (
                    <ul className="coming-soon-features">
                        {features.map((feature, i) => (
                            <li key={i}>{feature}</li>
                        ))}
                    </ul>
                )}

                <Link to={`/${nk}/dashboard`} className="coming-soon-cta">
                    <ArrowLeft size={14} />
                    Back to Dashboard
                </Link>

                {estimatedRelease && (
                    <p className="coming-soon-eta">
                        Estimated availability: {estimatedRelease}
                    </p>
                )}
            </div>
        </div>
    )
}
