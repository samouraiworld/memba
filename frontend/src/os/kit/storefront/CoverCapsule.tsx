import type { CSSProperties } from "react"
import type { SubjectSummary } from "../../../lib/reviews"
import { RatingBadge } from "./RatingBadge"

export interface CapsuleProps {
    title: string
    pitch: string
    cover: string | null
    accent: string
    tags: readonly string[]
    costTag: { label: string; tone: "free" | "warn" }
    summary?: SubjectSummary
    /** Opens the entry's page. */
    onOpen?: () => void
    /** Starts the game directly; a separate button, never nested in the card's own. */
    onPlay?: () => void
    /** External entry: the card is a link that opens in a new tab. */
    href?: string
    linkLabel?: string
    disabled?: boolean
}

export function CoverCapsule({ title, pitch, cover, accent, tags, costTag, summary, onOpen, onPlay, href, linkLabel, disabled }: CapsuleProps) {
    const inner = <>
        <span className="os-cin-cap-art" style={{ "--cap-accent": accent } as CSSProperties}>
            {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="os-cin-cap-word" aria-hidden="true">{title}</span>}
        </span>
        <span className="os-cin-cap-body">
            <b>{title}</b>
            <span className="os-cin-sub">{pitch}</span>
            <span className="os-cin-row">
                {tags.map((tag) => <span key={tag} className="os-cin-tag">{tag}</span>)}
                <span className={`os-cin-tag os-cin-tag--${costTag.tone}`}>{costTag.label}</span>
                <RatingBadge summary={summary} />
            </span>
        </span>
    </>
    return <article className={`os-cin-cap${disabled ? " is-off" : ""}`}>
        {href
            ? <a className="os-cin-cap-hit" href={href} target="_blank" rel="noopener noreferrer" aria-label={linkLabel ?? title}>{inner}</a>
            : <button type="button" className="os-cin-cap-hit" onClick={onOpen} aria-label={`Details for ${title}`}>{inner}</button>}
        {onPlay && <button type="button" className="os-cin-cap-play" onClick={onPlay} aria-label={`Play ${title}`}>Play</button>}
    </article>
}
