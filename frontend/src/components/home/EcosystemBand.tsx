/**
 * EcosystemBand — below-the-fold "ecosystem at a glance" band.
 *
 * R2-H7: instead of bare counts ("1 tokens / 8 validators"), each section now
 * surfaces the REAL items inline:
 *   - tokens:     name + symbol + on-chain supply, from useTokenLaunches()
 *                 (fetchTokens + per-token getTokenInfo), capped at the top 3
 *                 with a "view all N →" link.
 *   - validators: "Top validators" — moniker (or truncated addr) + voting-power
 *                 share % + status, from useEcosystemValidators() (getValidators,
 *                 power-desc), capped at the top 3 with a "view all N →" link.
 *   - agents:     count-only tile (unchanged — no honest network-wide list).
 *
 * The count stays as each section's header.
 *
 * HONESTY:
 *   - A section is OMITTED entirely when its list is empty (never a fabricated
 *     row, never "0"). The header count is taken from the live snapshot when
 *     usable, otherwise derived from the fetched list length so it never
 *     contradicts the rows below it.
 *   - While a list is fetching, a compact loading placeholder is shown (so the
 *     section is present but never displays stale/blank rows).
 *   - If nothing is present and nothing is loading, the whole band renders null.
 *
 * Token-driven colors via CSS variables → dark/light parity + reduced-motion
 * safe. These sit in the below-fold (NOT inside a card-link), so plain inline
 * <Link>s are fine.
 *
 * @module components/home/EcosystemBand
 */
import { Link } from "react-router-dom"
import { useHomeSnapshot } from "../../hooks/home/useHomeSnapshot"
import { useTokenLaunches } from "../../hooks/home/useTokenLaunches"
import { useEcosystemValidators } from "../../hooks/home/useEcosystemValidators"
import { truncateAddr } from "../../lib/format"
import "./home.css"

/** Max rows shown inline per section before collapsing to a "view all N" link.
 *  Kept tight (3) so the band stays compact and dense rather than ballooning. */
const VALIDATOR_TOP_N = 3
const TOKEN_TOP_N = 3

export interface EcosystemBandProps {
    networkKey: string
}

interface Tile {
    key: string
    label: string
    value: number
}

/** A validator's power share, e.g. 60 → "60%". Falls back to "—" when unknown. */
function powerShare(percent: number): string {
    if (!Number.isFinite(percent) || percent <= 0) return "—"
    // Whole numbers stay whole; otherwise one decimal (e.g. 12.5%).
    const rounded = Math.round(percent * 10) / 10
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

export function EcosystemBand({ networkKey }: EcosystemBandProps) {
    const { snapshot, usable } = useHomeSnapshot()
    const counts = usable ? snapshot?.counts : undefined

    // tokens is already the top-N (enriched with supply/admin); tokenTotal is the
    // full count, so the header + "view all N" stay accurate against the slice.
    const { tokens, total: tokenTotal, loading: tokensLoading } = useTokenLaunches(TOKEN_TOP_N)
    const { validators, total: validatorTotal, loading: validatorsLoading } = useEcosystemValidators()

    const tokensHref = `/${networkKey}/tokens`
    const validatorsHref = `/${networkKey}/validators`

    // Header counts: the authoritative total is the GREATER of the fresh backend
    // snapshot and the fetched list length (tokenfactory tokens / the valset are
    // append-only, so neither source over-counts). Using max() — rather than
    // preferring one source — keeps the count honest when the two diverge, e.g.
    // the snapshot reports 3 tokens while the 5-min-cached fetchTokens still holds
    // 1 right after a launch (MH-14). The "view all N" affordance below then keys
    // off this count vs the rows actually shown, so the band never implies a
    // partial/stale list is the whole set.
    const tokenCount = Math.max(counts?.tokens ?? 0, tokenTotal)
    const validatorCount = Math.max(counts?.validators ?? 0, validatorTotal)

    const showTokens = tokensLoading || tokens.length > 0
    const showValidators = validatorsLoading || validators.length > 0

    // Agents and NFT collections stay count-only tiles (omitted at 0 — never a
    // fabricated 0). Collections was computed by the snapshot all along but
    // never rendered here (next-cycle plan, Wave 0.2).
    const countTiles: Tile[] = [
        { key: "agents", label: "agents", value: counts?.agents },
        { key: "collections", label: "NFT collections", value: counts?.collections },
    ].filter((t): t is Tile => typeof t.value === "number" && t.value > 0)

    if (!showTokens && !showValidators && countTiles.length === 0) return null

    const topValidators = validators.slice(0, VALIDATOR_TOP_N)

    return (
        <section className="ecosystem-band" data-testid="ecosystem-band">
            <div className="below-fold__eyebrow">ecosystem at a glance</div>
            <div className="ecosystem-band__sections">
                {showTokens && (
                    <div className="ecosystem-section" data-testid="eco-tokens">
                        <Link to={tokensHref} className="ecosystem-section__header">
                            <span className="ecosystem-section__count">{tokenCount}</span>
                            <span className="ecosystem-section__label">{tokenCount === 1 ? "token" : "tokens"}</span>
                            <span className="ecosystem-section__arrow" aria-hidden="true">→</span>
                        </Link>
                        {tokensLoading ? (
                            <div className="ecosystem-section__loading" data-testid="eco-tokens-loading">
                                loading tokens…
                            </div>
                        ) : (
                            <>
                                <ul className="ecosystem-list">
                                    {tokens.map((t) => (
                                        <li key={t.path} className="ecosystem-list__item">
                                            <Link to={tokensHref} className="ecosystem-row" data-testid="eco-token-row">
                                                <span className="ecosystem-row__main">
                                                    <span className="ecosystem-row__name">{t.name}</span>
                                                    <span className="ecosystem-row__badge">{t.symbol}</span>
                                                </span>
                                                <span className="ecosystem-row__sub">
                                                    {t.supplyDisplay ? `${t.supplyDisplay} supply` : t.path}
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                                {tokenCount > tokens.length && (
                                    <Link to={tokensHref} className="ecosystem-section__viewall" data-testid="eco-tokens-viewall">
                                        view all {tokenCount} →
                                    </Link>
                                )}
                            </>
                        )}
                    </div>
                )}

                {showValidators && (
                    <div className="ecosystem-section" data-testid="eco-validators">
                        <Link to={validatorsHref} className="ecosystem-section__header">
                            <span className="ecosystem-section__count">{validatorCount}</span>
                            <span className="ecosystem-section__label">Top validators</span>
                            <span className="ecosystem-section__arrow" aria-hidden="true">→</span>
                        </Link>
                        {validatorsLoading ? (
                            <div className="ecosystem-section__loading" data-testid="eco-validators-loading">
                                loading validators…
                            </div>
                        ) : (
                            <>
                                <ul className="ecosystem-list">
                                    {topValidators.map((v, i) => {
                                        const name = v.moniker?.trim() || truncateAddr(v.gnoAddr)
                                        const statusClass = v.active ? "is-active" : "is-inactive"
                                        return (
                                            <li key={v.gnoAddr || `${name}-${i}`} className="ecosystem-list__item">
                                                <Link to={validatorsHref} className="ecosystem-row" data-testid="eco-validator-row">
                                                    <span className="ecosystem-row__main">
                                                        <span
                                                            className={`ecosystem-row__dot ${statusClass}`}
                                                            aria-hidden="true"
                                                        />
                                                        <span className="ecosystem-row__name" data-testid="eco-validator-name">{name}</span>
                                                    </span>
                                                    <span className="ecosystem-row__sub">
                                                        {powerShare(v.powerPercent)} power
                                                        {" · "}
                                                        {v.active ? "active" : "inactive"}
                                                    </span>
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                                {validatorCount > topValidators.length && (
                                    <Link
                                        to={validatorsHref}
                                        className="ecosystem-section__viewall"
                                        data-testid="eco-validators-viewall"
                                    >
                                        view all {validatorCount} →
                                    </Link>
                                )}
                            </>
                        )}
                    </div>
                )}

                {countTiles.map((t) => (
                    <div key={t.key} className="ecosystem-section ecosystem-section--tile" data-testid={`eco-${t.key}`}>
                        <div className="ecosystem-section__header ecosystem-section__header--static">
                            <span className="ecosystem-section__count">{t.value}</span>
                            <span className="ecosystem-section__label">{t.label}</span>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}
