/**
 * MarketCard — the ONE marketplace card (marketplace-v2 Phase 1).
 *
 * Every lane renders through this via a `CardModel` (per-lane adapters produce it),
 * so the card never branches on asset type. Styling is 100% CSS (`MarketCard.css`) —
 * no inline style objects and no JS hover handlers (the NftLane anti-pattern this
 * replaces). The monogram gradient is the single sanctioned inline-color exception.
 *
 * @module components/marketplace/MarketCard
 */
import { memo } from "react"
import { Link } from "react-router-dom"
import { VerifiedBadge } from "../nft/VerifiedBadge"
import type { CardModel } from "../../lib/marketplace/types"
import "./MarketCard.css"

/** Deterministic hue [0,360) from a seed string — stable per listing. */
function seedHue(seed: string): number {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
    return h
}

/** Show a bech32 address as `g1abcdef…wxyz` (full value stays in the title attr). */
function truncAddr(addr: string): string {
    return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

export interface MarketCardProps {
    model: CardModel
}

function MarketCardImpl({ model }: MarketCardProps) {
    const { media, seller } = model
    const hue = seedHue(media.seed ?? model.id)

    return (
        <Link to={model.href} className="mkt-card" data-lane={model.lane}>
            <div className="mkt-card__media">
                {media.kind === "art" && media.src ? (
                    <img className="mkt-card__art" src={media.src} alt="" loading="lazy" />
                ) : (
                    <div
                        className="mkt-card__monogram"
                        aria-hidden="true"
                        // Sanctioned exception to tokens-only: per-listing deterministic gradient.
                        style={{
                            background: `linear-gradient(135deg, hsl(${hue} 68% 46%), hsl(${(hue + 40) % 360} 68% 34%))`,
                        }}
                    >
                        <span className="mkt-card__monogram-glyph">
                            {model.title.slice(0, 1).toUpperCase()}
                        </span>
                    </div>
                )}
            </div>

            <div className="mkt-card__body">
                <div className="mkt-card__title-row">
                    <h3 className="mkt-card__title">{model.title}</h3>
                    {model.verified && <VerifiedBadge verified compact />}
                </div>

                <div className="mkt-card__seller">
                    <span className="mkt-card__handle">{seller.handle}</span>
                    <span className="mkt-card__addr" title={seller.address}>
                        {truncAddr(seller.address)}
                    </span>
                </div>

                <div className="mkt-card__rep">
                    {seller.reputation ? (
                        <>
                            <span className="mkt-card__rating">★ {seller.reputation.rating.toFixed(1)}</span>
                            <span className="mkt-card__level">{seller.reputation.level}</span>
                            <span className="mkt-card__rep-count">({seller.reputation.count})</span>
                        </>
                    ) : (
                        <span className="mkt-card__new">New seller</span>
                    )}
                </div>

                {model.stats.length > 0 && (
                    <dl className="mkt-card__stats">
                        {model.stats.map((s) => (
                            <div key={s.label} className="mkt-card__stat">
                                <dt className="mkt-card__stat-label">{s.label}</dt>
                                <dd className={"mkt-card__stat-value" + (s.mono ? " mkt-card__stat-value--mono" : "")}>
                                    {s.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}

                <div className="mkt-card__footer">
                    <span className="mkt-card__price">{model.priceLabel}</span>
                    {model.action && (
                        <button
                            type="button"
                            className="k-btn-primary mkt-card__action"
                            onClick={(e) => {
                                // The card is a link; keep the action click from navigating.
                                e.preventDefault()
                                e.stopPropagation()
                                model.action?.onClick?.()
                            }}
                        >
                            {model.action.label}
                        </button>
                    )}
                </div>
            </div>
        </Link>
    )
}

/** Memoized — the grid renders many cards; a stable `model` ref skips re-render. */
const MarketCard = memo(MarketCardImpl)
export default MarketCard
