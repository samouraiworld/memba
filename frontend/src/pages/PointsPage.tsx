/**
 * PointsPage — the Reputation surface: the connected member's rank + the global
 * MP leaderboard, via the flag-gated PointsPanel. The route + nav entry are wired
 * ahead of the points_v1 launch so flipping VITE_ENABLE_POINTS is the only go-live
 * step. Until then this renders a "coming soon" card (PointsPanel itself self-gates
 * to null, so the page owns the off-state copy).
 *
 * @module pages/PointsPage
 */
import { useEffect } from "react"
import { useOutletContext } from "react-router-dom"
import { PointsPanel } from "../components/points/PointsPanel"
import { isPointsEnabled } from "../lib/config"
import type { LayoutContext } from "../types/layout"

export default function PointsPage() {
    const { auth } = useOutletContext<LayoutContext>()

    useEffect(() => {
        document.title = "Reputation — Memba"
    }, [])

    return (
        <div className="points-page animate-fade-in">
            {isPointsEnabled() ? (
                <>
                    <header className="points-page__header">
                        <h1 className="points-page__title">Reputation</h1>
                        <p className="points-page__subtitle">
                            Soulbound, on-chain reputation for contributions to the Memba ecosystem.
                        </p>
                        <p className="points-page__disclaimer" role="note">
                            Memba Points (MP) are soulbound reputation — <strong>not a token</strong>: no cash
                            value, non-transferable, and <strong>not a claim</strong> on any airdrop or token
                            distribution.
                        </p>
                    </header>
                    <PointsPanel address={auth.address || undefined} />
                </>
            ) : (
                <div className="k-card points-page__soon">
                    <h1 className="points-page__title">Reputation</h1>
                    <p className="points-page__soon-text">
                        Memba Points — soulbound, on-chain reputation — is coming soon.
                    </p>
                </div>
            )}
        </div>
    )
}
