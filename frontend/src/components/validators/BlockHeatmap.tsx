/**
 * BlockHeatmap — dense 100-block signing health visualization.
 *
 * Displays a 10-column grid of colored squares where:
 * - Green (solid)  = all validators signed (perfect block)
 * - Teal (partial) = 2/3+ signed but not all (healthy consensus)
 * - Yellow         = below 2/3 threshold (warning — rounds required)
 * - Red            = very low signing rate (critical)
 * - Gray           = data not yet loaded / block skipped
 *
 * Each cell is clickable (shows block height tooltip).
 * Newest blocks appear at the start of the row (top-left = most recent).
 */

import type { BlockSample } from "../../lib/validators"

interface BlockHeatmapProps {
    blocks: BlockSample[]
    loading: boolean
    /** Total current validators — used to normalize healthRatio if provided */
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
        />
    )
}

function EmptyCell({ index }: { index: number }) {
    return (
        <div
            className="hm-cell hm-cell--empty"
            aria-label={`Block slot ${index} loading`}
            role="img"
        />
    )
}

export function BlockHeatmap({ blocks, loading, totalValidators }: BlockHeatmapProps) {
    // Reverse so newest block = top-left in grid
    const sorted = [...blocks].reverse()

    // Target 100 cells — pad with empties when data is loading or incomplete
    const TARGET = 100
    const cells = sorted.length >= TARGET ? sorted.slice(0, TARGET) : sorted

    // Label for the legend
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

            <div
                className="hm-grid"
                aria-label="Block health heatmap"
                role="grid"
            >
                {cells.map((b) => (
                    <BlockCell key={b.height} sample={b} />
                ))}
                {/* Pad the remainder of the grid with empty cells while loading */}
                {loading && cells.length < TARGET && Array.from({ length: TARGET - cells.length }).map((_, i) => (
                    <EmptyCell key={`empty-${i}`} index={i} />
                ))}
            </div>

            {/* Legend */}
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
