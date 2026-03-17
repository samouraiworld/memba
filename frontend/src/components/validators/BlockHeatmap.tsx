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

function BlockCell({ sample }: { sample: BlockSample }) {
    const color = healthColor(sample)
    const label = `Block ${sample.height}: ${sample.signerCount}/${sample.valsetSize} signed`
    return (
        <div
            className={`hm-cell hm-cell--${color}`}
            title={label}
            aria-label={label}
            role="img"
        >
            <span className="hm-cell__count">{sample.signerCount}</span>
        </div>
    )
}

function EmptyCell() {
    return <div className="hm-cell hm-cell--empty" role="img" aria-label="loading" />
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
                {loading && <span className="hk-pulse" aria-label="Updating…" />}
            </div>

            <div className="hm-grid" aria-label="Block health heatmap" role="grid">
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
