import { Link } from "react-router-dom"
import { formatVotingPower, formatPercent, formatRelativeTime, truncateValidatorAddr, type ValidatorInfo } from "../../lib/validators"
import { ValidatorHealthStatus, healthCssClass, healthLabel, healthIcon } from "../../lib/validatorHealth"

interface ValidatorCardProps {
    v: ValidatorInfo
    hasMonitoring: boolean
    /** Network-prefixed path to the validator's profile. */
    to: string
}

/**
 * ValidatorCard — the mobile representation of one roster row. The desktop table
 * is dense (6–13 columns) and forces horizontal scroll on a phone; on mobile the
 * roster renders these vertical cards instead (the desktop `<table>` is untouched
 * — `Validators` picks per `useIsMobile()`). The whole card is a single tappable
 * link to the profile, so it's a comfortable touch target by construction.
 *
 * When a validator is Degraded or Down, the card states WHY as visible text. That
 * reason used to live only in a `title=` tooltip on the badge — which a touch
 * screen can never reveal, and cards only render on touch-sized screens — so the
 * accusation was visible and its evidence was not.
 */
export function ValidatorCard({ v, hasMonitoring, to }: ValidatorCardProps) {
    const name = v.moniker || truncateValidatorAddr(v.address)
    const label = healthLabel(v.healthStatus)
    // Show the reason only when something is wrong: "All signals nominal" on every
    // healthy card is noise, while on a Down card the reason is the whole point.
    const reason = v.healthMeta?.reason ?? ""
    const showReason = !!reason
        && (v.healthStatus === ValidatorHealthStatus.Down || v.healthStatus === ValidatorHealthStatus.Degraded)
    return (
        <Link
            to={to}
            className="val-card"
            data-testid={`validator-card-${v.rank}`}
            // aria-label overrides everything inside the link, badge included, so it
            // must carry the health state (and reason) itself — otherwise
            // screen-reader users hear a name and nothing about whether it's up.
            aria-label={`View ${name} validator details — ${label}${showReason ? `: ${reason}` : ""}`}
        >
            <div className="val-card__head">
                <span className={`val-rank-badge ${v.rank <= 3 ? "val-top3" : ""}`}>{v.rank}</span>
                <div className="val-card__id">
                    <span className="val-card__moniker">{name}</span>
                    <span className="val-card__addr val-mono">{v.gnoAddr || truncateValidatorAddr(v.address)}</span>
                </div>
                <span className={`val-health-badge ${healthCssClass(v.healthStatus)}`}>
                    <span className="val-health-badge__icon">{healthIcon(v.healthStatus)}</span>
                    <span className="val-health-badge__label">{label}</span>
                </span>
            </div>

            {showReason && (
                <p className={`val-card__reason val-card__reason--${v.healthStatus}`}>{reason}</p>
            )}

            <div className="val-card__stats">
                <div className="val-card__stat">
                    <span className="val-card__stat-label">Power</span>
                    <span className="val-card__stat-val val-mono">{formatVotingPower(v.votingPower)}</span>
                </div>
                <div className="val-card__stat">
                    <span className="val-card__stat-label">Share</span>
                    <span className="val-card__stat-val">{v.powerPercent.toFixed(1)}%</span>
                </div>
                {hasMonitoring && v.uptimePercent != null && (
                    <div className="val-card__stat">
                        <span className="val-card__stat-label">Uptime</span>
                        <span className="val-card__stat-val">{formatPercent(v.uptimePercent)}</span>
                    </div>
                )}
                <div className="val-card__stat">
                    <span className="val-card__stat-label">Active</span>
                    <span className="val-card__stat-val">
                        {v.operationTime != null ? `${v.operationTime}d` : formatRelativeTime(v.startTime)}
                    </span>
                </div>
            </div>
        </Link>
    )
}
