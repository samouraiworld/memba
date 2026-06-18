/**
 * YourWorldsPanel — Member-only StateBoard panel showing saved DAOs.
 *
 * Per-panel graceful-degradation contract (applies to all home panels):
 *   - NEVER throw during render — degrade gracefully on error or no data
 *   - NEVER blank — always show a card structure (invitation when empty)
 *   - With saved DAOs: renders DashboardDAOList (reuses its internal fetch)
 *   - Without saved DAOs: renders a cold-start invitation, never an empty box
 *
 * @module components/home/panels/YourWorldsPanel
 */

import { useOutletContext } from "react-router-dom"
import { useOrg } from "../../../contexts/OrgContext"
import { getSavedDAOsForOrg } from "../../../lib/daoSlug"
import { GNO_FAUCET_URL } from "../../../lib/config"
import { DashboardDAOList } from "../../dashboard/DashboardDAOList"
import { useNetworkPath } from "../../../hooks/useNetworkNav"
import type { LayoutContext } from "../../../types/layout"
import "../home.css"

/**
 * YourWorldsPanel — renders inside StateBoard on the member Control Room.
 * Member-only: Home.tsx must NOT render this on the visitor board.
 */
export function YourWorldsPanel() {
    const { auth } = useOutletContext<LayoutContext>()
    const { activeOrgId } = useOrg()
    const networkPath = useNetworkPath()

    const userAddress = auth.isAuthenticated ? (auth.address ?? null) : null
    const savedDAOs = getSavedDAOsForOrg(activeOrgId)

    return (
        <div className="your-worlds-panel" data-testid="your-worlds-panel">
            {/* Panel title header */}
            <div className="panel-title-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14 }}>🌐</span>
                <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Your worlds</h3>
                {savedDAOs.length > 0 && (
                    <span className="k-label" style={{ marginLeft: "auto" }}>
                        {savedDAOs.length} {savedDAOs.length === 1 ? "DAO" : "DAOs"}
                    </span>
                )}
            </div>

            {savedDAOs.length > 0 ? (
                /* Reuse DashboardDAOList — it fetches per-DAO activity internally */
                <DashboardDAOList savedDAOs={savedDAOs} userAddress={userAddress} />
            ) : (
                /* Cold-start invitation — never a blank panel */
                <div className="your-worlds-invite" data-testid="your-worlds-invite">
                    <p style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        marginBottom: 12,
                        fontFamily: "JetBrains Mono, monospace",
                    }}>
                        Pin a DAO to track it here.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <a
                            href={networkPath("dao")}
                            className="action-card action-card--teal"
                            data-testid="invite-join-dao"
                            aria-label="Browse and join a DAO"
                        >
                            <div className="action-card__rail action-card__rail--teal" />
                            <div className="action-card__body">
                                <span className="action-card__eyebrow">explore</span>
                                <span className="action-card__title">Join a DAO</span>
                                <span className="action-card__meta">Browse governance communities</span>
                            </div>
                            <span className="action-card__action-label">Go →</span>
                        </a>

                        {GNO_FAUCET_URL && (
                            <a
                                href={GNO_FAUCET_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="action-card action-card--amber"
                                data-testid="invite-faucet"
                                aria-label="Claim free testnet GNOT"
                            >
                                <div className="action-card__rail action-card__rail--amber" />
                                <div className="action-card__body">
                                    <span className="action-card__eyebrow">faucet</span>
                                    <span className="action-card__title">Claim testnet GNOT</span>
                                    <span className="action-card__meta">Free tokens to get started</span>
                                </div>
                                <span className="action-card__action-label">Open →</span>
                            </a>
                        )}

                        {/* Faucet fallback when no faucet URL — always show invite-faucet testid for tests */}
                        {!GNO_FAUCET_URL && (
                            <div
                                className="action-card action-card--neutral"
                                data-testid="invite-faucet"
                                aria-label="Faucet not available on this network"
                            >
                                <div className="action-card__rail action-card__rail--neutral" />
                                <div className="action-card__body">
                                    <span className="action-card__eyebrow">faucet</span>
                                    <span className="action-card__title">Testnet GNOT</span>
                                    <span className="action-card__meta">Not available on this network</span>
                                </div>
                            </div>
                        )}

                        <a
                            href={networkPath("quests")}
                            className="action-card action-card--neutral"
                            data-testid="invite-quests"
                            aria-label="Try a quest to earn XP"
                        >
                            <div className="action-card__rail action-card__rail--neutral" />
                            <div className="action-card__body">
                                <span className="action-card__eyebrow">quests</span>
                                <span className="action-card__title">Try a quest</span>
                                <span className="action-card__meta">Earn XP and badges</span>
                            </div>
                            <span className="action-card__action-label">Go →</span>
                        </a>
                    </div>
                </div>
            )}
        </div>
    )
}
