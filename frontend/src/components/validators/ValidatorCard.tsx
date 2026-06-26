import { Link } from "react-router-dom"
import { formatVotingPower, formatRelativeTime, truncateValidatorAddr, type ValidatorInfo } from "../../lib/validators"
import { healthCssClass, healthLabel, healthIcon } from "../../lib/validatorHealth"

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
 */
export function ValidatorCard({ v, hasMonitoring, to }: ValidatorCardProps) {
    const name = v.moniker || truncateValidatorAddr(v.address)
    return (
        <Link
            to={to}
            className="val-card"
            data-testid={`validator-card-${v.rank}`}
            aria-label={`View ${name} validator details`}
        >
            <div className="val-card__head">
                <span className={`val-rank-badge ${v.rank <= 3 ? "val-top3" : ""}`}>{v.rank}</span>
                <div className="val-card__id">
                    <span className="val-card__moniker">{name}</span>
                    <span className="val-card__addr val-mono">{v.gnoAddr || truncateValidatorAddr(v.address)}</span>
                </div>
                <span className={`val-health-badge ${healthCssClass(v.healthStatus)}`} title={v.healthMeta?.reason || ""}>
                    <span className="val-health-badge__icon">{healthIcon(v.healthStatus)}</span>
                    <span className="val-health-badge__label">{healthLabel(v.healthStatus)}</span>
                </span>
            </div>

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
                        <span className="val-card__stat-val">{v.uptimePercent}%</span>
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
