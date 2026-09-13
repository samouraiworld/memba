/**
 * BlockHeatmap — dense 100-block signing health visualization.
 * Gnockpit-style: shows signer count inside each cell.
 * 25-column grid (4 rows of 25), compact cells (16px).
 */

import type { BlockSample } from "../../lib/validators"

interface BlockHeatmapProps {
    blocks: BlockSample[]
    loading: boolean
    totalValidators?: number
}

function healthColor(sample: BlockSample): "perfect" | "healthy" | "warn" | "critical" {
    const r = sample.healthRatio
    if (r >= 1.0) return "perfect"
    if (r >= 0.67) return "healthy"
    if (r >= 0.33) return "warn"
    return "critical"
}

// Cells are presentational: the strip is exposed as ONE labelled image (see
// `summarise`). It used to be `role="grid"` around up to a hundred
// `role="img"` cells — a grid must own rows and cells and promises arrow-key
// navigation, and a hundred labelled images is a hundred screen-reader stops.
// The per-block tooltip stays for mouse users.
function BlockCell({ sample }: { sample: BlockSample }) {
    const color = healthColor(sample)
    return (
        <div
            className={`hm-cell hm-cell--${color}`}
            title={`Block ${sample.height}: ${sample.signerCount}/${sample.valsetSize} signed`}
        >
            <span className="hm-cell__count">{sample.signerCount}</span>
        </div>
    )
}

function EmptyCell() {
    return <div className="hm-cell hm-cell--empty" />
}

/** What a screen reader hears for the whole strip. `cells` is newest first. */
function summarise(cells: BlockSample[], loading: boolean): string {
    if (cells.length === 0) return loading ? "Recent blocks loading" : "No recent blocks to show"
    const span = `Last ${cells.length} block${cells.length === 1 ? "" : "s"}`
    const covered = cells.filter(b => b.signerCount > 0)
    if (covered.length === 0) return `${span}: no signatures recorded.`
    const perfect = cells.filter(b => b.perfect).length
    if (perfect === covered.length) return `${span}: all ${perfect} fully signed.`
    // Strict `<` keeps the first — most recent — block on a tie.
    const weakest = covered.reduce((w, b) => (b.healthRatio < w.healthRatio ? b : w))
    return `${span}: ${perfect} of ${covered.length} fully signed. `
        + `Weakest: block ${weakest.height}, ${weakest.signerCount} of ${weakest.valsetSize} signatures.`
}

export function BlockHeatmap({ blocks, loading, totalValidators }: BlockHeatmapProps) {
    const sorted = [...blocks].reverse()
    const TARGET = 100
    const cells = sorted.length >= TARGET ? sorted.slice(0, TARGET) : sorted
    const coveredBlocks = cells.filter(b => b.signerCount > 0).length
    const perfectBlocks = cells.filter(b => b.perfect).length

    return (
        <div className="hk-card hk-heatmap" id="hk-block-heatmap">
            <div className="hk-card__title">
                <span className="hk-card__icon">⬡</span>
                RECENT BLOCKS
                <span className="hk-heatmap__meta">
                    last {cells.length} blocks — {perfectBlocks}/{coveredBlocks} perfect
                </span>
                {loading && <span className="hk-pulse" aria-hidden="true" />}
            </div>

            <div className="hm-grid" role="img" aria-label={summarise(cells, loading)}>
                {cells.map((b) => <BlockCell key={b.height} sample={b} />)}
                {loading && cells.length < TARGET && Array.from({ length: TARGET - cells.length }).map((_, i) => (
                    <EmptyCell key={`empty-${i}`} />
                ))}
            </div>

            <div className="hm-legend">
                <span className="hm-legend__item hm-legend__item--perfect">● Perfect</span>
                <span className="hm-legend__item hm-legend__item--healthy">● ≥2/3</span>
                <span className="hm-legend__item hm-legend__item--warn">● &lt;2/3</span>
                <span className="hm-legend__item hm-legend__item--critical">● Critical</span>
                <span className="hm-legend__item hm-legend__item--empty">□ Loading</span>
                {totalValidators && (
                    <span className="hm-legend__valset">valset: {totalValidators}</span>
                )}
            </div>
        </div>
    )
}
