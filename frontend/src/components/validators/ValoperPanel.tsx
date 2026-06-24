/**
 * ValoperPanel — surfaces the test13 validator-onboarding registry
 * (gno.land/r/gnops/valopers) on the Validators page.
 *
 * Shows every registered operator with its live status:
 *   active    — signing address is in the consensus set
 *   candidate — registered on-chain but not yet validating
 *
 * It also makes the onboarding identity model legible — operator address (stable
 * identity) vs signing address (rotatable consensus key) — and links out to the
 * onboarding flow. This is the visible payoff of the valoper system the gno core
 * team shipped for test13.
 */
import { useMemo } from "react"
import { valoperGnowebBase, type ValoperWithStatus } from "../../lib/valopers"
import { truncateValidatorAddr } from "../../lib/validators"
import { useNetworkNav } from "../../hooks/useNetworkNav"

const SERVER_TYPE_LABEL: Record<string, string> = {
    "cloud": "Cloud",
    "on-prem": "On-prem",
    "data-center": "Data center",
}

// gnoweb render path for a single valoper profile — active-network host (never mainnet).
const profileUrl = (operatorAddress: string) =>
    `${valoperGnowebBase()}/r/gnops/valopers:${operatorAddress}`

// The test13 validator onboarding write-up.
const ONBOARDING_URL = "https://gno.land/r/gnoland/blog:p/validator-test13"

interface ValoperPanelProps {
    valopers: ValoperWithStatus[]
    loading: boolean
}

export function ValoperPanel({ valopers, loading }: ValoperPanelProps) {
    const nav = useNetworkNav()
    const activeCount = useMemo(
        () => valopers.filter(v => v.status === "active").length,
        [valopers],
    )
    const candidateCount = valopers.length - activeCount

    // Active first, then candidates; alphabetical within each group.
    const sorted = useMemo(
        () =>
            [...valopers].sort((a, b) =>
                a.status === b.status
                    ? a.moniker.localeCompare(b.moniker)
                    : a.status === "active"
                      ? -1
                      : 1,
            ),
        [valopers],
    )

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
                        ? `Registered validator operators · ${activeCount} active · ${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`
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

            <div className="val-valopers__grid">
                {sorted.map(v => (
                    <div
                        key={v.operatorAddress}
                        className="val-valoper-card val-valoper-card--clickable"
                        data-testid="valoper-card"
                        role="button"
                        tabIndex={0}
                        onClick={() => nav(`validators/valoper/${v.operatorAddress}`, { state: { valoper: v } })}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                nav(`validators/valoper/${v.operatorAddress}`, { state: { valoper: v } })
                            }
                        }}
                    >
                        <div className="val-valoper-card__top">
                            <span className="val-valoper-card__moniker">{v.moniker}</span>
                            <span className={`val-valoper-status val-valoper-status--${v.status}`}>
                                {v.status === "active" ? "Active" : "Candidate"}
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
                ))}
            </div>
        </div>
    )
}
