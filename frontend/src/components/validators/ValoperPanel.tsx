/**
 * ValoperPanel — surfaces the test13 validator-onboarding registry
 * (gno.land/r/gnops/valopers) on the Validators page.
 *
 * Shows every registered operator, split into two clearly-separated groups:
 *   Active validator operators — signing address is in the live consensus set
 *   Candidates                 — registered on-chain but not yet validating
 *
 * Candidates get their own dedicated section (not mixed into the active list)
 * since they are not yet validators. It also makes the onboarding identity model
 * legible — operator address (stable identity) vs signing address (rotatable
 * consensus key) — and links out to the onboarding flow. This is the visible
 * payoff of the valoper system the gno core team shipped for test13.
 */
import { useMemo } from "react"
import { type ValoperWithStatus } from "../../lib/valopers"
import { truncateValidatorAddr } from "../../lib/validators"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { getExplorerBaseUrl } from "../../lib/config"

const SERVER_TYPE_LABEL: Record<string, string> = {
    "cloud": "Cloud",
    "on-prem": "On-prem",
    "data-center": "Data center",
}

// gnoweb render path for a single valoper profile — active-network host (never mainnet).
const profileUrl = (operatorAddress: string) =>
    `${getExplorerBaseUrl()}/r/gnops/valopers:${operatorAddress}`

// The test13 validator onboarding write-up.
const ONBOARDING_URL = "https://gno.land/r/gnoland/blog:p/validator-test13"

const byMoniker = (a: ValoperWithStatus, b: ValoperWithStatus) =>
    a.moniker.localeCompare(b.moniker)

interface ValoperPanelProps {
    valopers: ValoperWithStatus[]
    loading: boolean
}

export function ValoperPanel({ valopers, loading }: ValoperPanelProps) {
    const nav = useNetworkNav()

    // Split into the two groups, each alphabetical by moniker. Candidates are
    // isolated from active operators — they are not yet validators.
    const { active, candidates } = useMemo(() => {
        const active: ValoperWithStatus[] = []
        const candidates: ValoperWithStatus[] = []
        for (const v of valopers) {
            (v.status === "active" ? active : candidates).push(v)
        }
        active.sort(byMoniker)
        candidates.sort(byMoniker)
        return { active, candidates }
    }, [valopers])

    const goTo = (v: ValoperWithStatus) =>
        nav(`validators/${v.operatorAddress}`, { state: { valoper: v } })

    return (
        <div className="val-valopers" data-testid="valoper-panel">
            <div className="val-valopers__head">
                <div className="val-valopers__title">
                    Valopers
                    {valopers.length > 0 && (
                        <span className="val-valopers__count">{valopers.length}</span>
                    )}
                    {loading && valopers.length === 0 && (
                        <span className="val-valopers__hint">loading…</span>
                    )}
                </div>
                <div className="val-valopers__sub">
                    {valopers.length > 0
                        ? `Registered validator operators · ${active.length} active · ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`
                        : "Operators who registered on-chain to run a validator"}
                </div>
                <a
                    className="val-valopers__cta"
                    href={ONBOARDING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Become a validator ↗
                </a>
            </div>

            {valopers.length === 0 && !loading && (
                <div className="val-valopers__empty">No valopers registered yet.</div>
            )}

            {active.length > 0 && (
                <section className="val-valopers__section" data-testid="valoper-section-active">
                    <header className="val-valopers__section-head">
                        <h3 className="val-valopers__section-title">
                            Active validator operators
                            <span className="val-valopers__count">{active.length}</span>
                        </h3>
                    </header>
                    <div className="val-valopers__grid">
                        {active.map(v => (
                            <ValoperCard key={v.operatorAddress} valoper={v} onOpen={goTo} />
                        ))}
                    </div>
                </section>
            )}

            {candidates.length > 0 && (
                <section className="val-valopers__section" data-testid="valoper-section-candidate">
                    <header className="val-valopers__section-head">
                        <h3 className="val-valopers__section-title">
                            Candidates
                            <span className="val-valopers__count val-valopers__count--candidate">
                                {candidates.length}
                            </span>
                        </h3>
                        <p className="val-valopers__section-note">
                            Registered on-chain — not yet in the consensus set.
                        </p>
                    </header>
                    <div className="val-valopers__grid">
                        {candidates.map(v => (
                            <ValoperCard key={v.operatorAddress} valoper={v} onOpen={goTo} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    )
}

interface ValoperCardProps {
    valoper: ValoperWithStatus
    onOpen: (v: ValoperWithStatus) => void
}

/** A single valoper profile card. Status is conveyed by the enclosing section,
 *  so the card itself carries no redundant status badge. */
function ValoperCard({ valoper: v, onOpen }: ValoperCardProps) {
    return (
        <div
            className="val-valoper-card val-valoper-card--clickable"
            data-testid="valoper-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(v)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen(v)
                }
            }}
        >
            <div className="val-valoper-card__top">
                <span className="val-valoper-card__moniker" data-testid="valoper-card-moniker">
                    {v.moniker}
                </span>
            </div>

            {v.serverType && (
                <span className="val-valoper-card__server">
                    {SERVER_TYPE_LABEL[v.serverType] ?? v.serverType}
                </span>
            )}

            {v.description && (
                <p className="val-valoper-card__desc">{v.description}</p>
            )}

            <dl className="val-valoper-card__addrs">
                <div>
                    <dt>Operator</dt>
                    <dd className="val-mono" title={v.operatorAddress}>
                        {truncateValidatorAddr(v.operatorAddress)}
                    </dd>
                </div>
                <div>
                    <dt>Signing</dt>
                    <dd className="val-mono" title={v.signingAddress || "not set"}>
                        {v.signingAddress ? truncateValidatorAddr(v.signingAddress) : "—"}
                    </dd>
                </div>
            </dl>

            <a
                className="val-valoper-card__profile"
                href={profileUrl(v.operatorAddress)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
            >
                View on gnoweb ↗
            </a>
        </div>
    )
}
