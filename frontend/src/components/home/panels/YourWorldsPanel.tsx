/**
 * YourWorldsPanel — Member-only panel showing saved DAOs as Door cards.
 *
 * Per-panel graceful-degradation contract (applies to all home panels):
 *   - NEVER throw during render — degrade gracefully on error or no data
 *   - NEVER blank — always show a card structure (invitation when empty)
 *   - With saved DAOs: renders per-world Door cards (useYourWorlds hook)
 *   - Without saved DAOs: renders a cold-start invitation, never an empty box
 *   - Individual world fetch errors degrade that card, not the whole panel
 *
 * @module components/home/panels/YourWorldsPanel
 */

import { useOrg } from "../../../contexts/OrgContext"
import { GNO_FAUCET_URL } from "../../../lib/config"
import { useNetworkKey } from "../../../hooks/useNetworkNav"
import { useYourWorlds } from "../../../hooks/home/useYourWorlds"
import { YourWorldsDoor } from "../doors/YourWorldsDoor"
import { Door } from "../Door"
import "../home.css"

/**
 * YourWorldsPanel — renders standalone in the member Control Room board zone,
 * directly below ActionInbox. Member-only: Home.tsx must NOT render this on the visitor board.
 */
export function YourWorldsPanel() {
    const { activeOrgId } = useOrg()
    const networkKey = useNetworkKey()

    const { state, worlds, refetch } = useYourWorlds(networkKey, activeOrgId)

    const hasWorlds = state === "ready" && worlds.length > 0

    return (
        <div className="your-worlds-panel" data-testid="your-worlds-panel">
            {/* Panel title header */}
            <div className="panel-title-row">
                <i className="ti ti-world" aria-hidden="true" />
                <h3>Your worlds</h3>
                {hasWorlds && (
                    <span className="k-label" style={{ marginLeft: "auto" }}>
                        {worlds.length} {worlds.length === 1 ? "DAO" : "DAOs"}
                    </span>
                )}
            </div>

            {state === "loading" && (
                <Door
                    variant="list"
                    state="loading"
                    eyebrow="your worlds"
                />
            )}

            {state === "error" && (
                <Door
                    variant="list"
                    state="error"
                    eyebrow="your worlds"
                    onRetry={refetch}
                />
            )}

            {state === "ready" && worlds.length > 0 && (
                <div className="your-worlds-board" data-testid="your-worlds-board">
                    {worlds.map((world) => (
                        <YourWorldsDoor key={world.href} world={world} />
                    ))}
                    {/* Always append "Add a world" invitation Door */}
                    <Door
                        variant="invitation"
                        state="empty"
                        eyebrow="add a world"
                        invitation={{ label: "Explore DAOs", href: `/${networkKey}/dao` }}
                    />
                </div>
            )}

            {(state === "empty" || (state === "ready" && worlds.length === 0)) && (
                /* Cold-start invitation — never a blank panel */
                <div className="your-worlds-invite" data-testid="your-worlds-invite">
                    <p className="your-worlds-invite__hint">
                        Pin a DAO to track it here.
                    </p>
                    <div className="your-worlds-invite__actions">
                        <a
                            href={`/${networkKey}/dao`}
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

                        {GNO_FAUCET_URL ? (
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
                        ) : (
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
                            href={`/${networkKey}/quests`}
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
