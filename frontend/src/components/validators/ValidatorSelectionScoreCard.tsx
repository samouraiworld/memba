/**
 * ValidatorSelectionScoreCard — an operator's entry in the validator selection
 * ranking: the final scores gno-score-validator computed from the candidates'
 * results on the gno.land testnets, sealed in gno.land/r/samcrew/validator_scores.
 *
 * It sits beside the live reliability score (ValidatorScoreCard) and is not the
 * same thing: a fixed record that supports choosing mainnet validators, not a
 * measure of how the node runs now.
 *
 * Shown only for an operator with an entry in the latest edition. No edition,
 * no entry, or a read that failed: no card, never an empty or zero score. No
 * "rank N of M" either: ranks come from the full scorecard, while the realm
 * holds only the candidates registered in valopers.
 */
import { useId } from "react"
import {
    arenaLabel,
    formatEditionDate,
    formatHundredths,
    selectionScoreFor,
    type SelectionScoreEdition,
} from "../../lib/validatorSelectionScores"

export function ValidatorSelectionScoreCard({
    edition,
    operatorAddress,
    realmUrl,
}: {
    /** The latest sealed edition; null or undefined while unread, unpublished or unreadable. */
    edition: SelectionScoreEdition | null | undefined
    /** The valoper operator address the ranking is keyed by. */
    operatorAddress: string
    /** The realm on this network's gnoweb. */
    realmUrl: string
}) {
    const titleId = `${useId()}-title`
    const entry = edition ? selectionScoreFor(edition, operatorAddress) : undefined
    if (!edition || !entry) return null

    const figures: Array<[string, string, boolean]> = [
        ["Total", formatHundredths(entry.total), true],
        ["Rank", `#${entry.rank}`, true],
        ...edition.arenas.map((arena, i): [string, string, boolean] => [arenaLabel(arena), formatHundredths(entry.arenaScores[i]), false]),
        ["GitHub bonus", formatHundredths(entry.github), false],
    ]

    return (
        <section className="vd-card vd-selection" aria-labelledby={titleId} data-testid="vd-selection-score">
            <div className="vd-card__title" id={titleId}>Selection score (testnets)</div>
            <p className="vd-score__intro">
                The final ranking of validator candidates, computed by gno-score-validator from their results on the
                gno.land testnets and recorded on chain. It does not follow live performance.
            </p>
            <p className="vd-score__meta">Edition {edition.number} · computed {formatEditionDate(edition.computedAt)}</p>
            <dl className="vd-score-drivers">
                {figures.map(([label, value, key], i) => (
                    <div key={`${i}:${label}`} className={`vd-score-driver${key ? " vd-score-driver--key" : ""}`}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            <a href={realmUrl} target="_blank" rel="noopener noreferrer" className="vp-peek__link">View the on-chain record ↗</a>
        </section>
    )
}
