import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react"

export interface HeroSlide {
    id: string
    kicker: string
    title: string
    pitch: string
    cover: string | null
    accent: string
    tags: readonly string[]
    primary: { label: string; onClick: () => void }
    secondary?: { label: string; onClick: () => void }
}

const ADVANCE_MS = 7000
const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Featured slides: autoplay only when visible, unhovered, unfocused, and motion is allowed. */
export function HeroCarousel({ label, slides, active = true }: { label: string; slides: readonly HeroSlide[]; active?: boolean }) {
    const [index, setIndex] = useState(0)
    const [paused, setPaused] = useState(false)
    const count = slides.length
    useEffect(() => {
        if (!active || paused || count < 2 || reducedMotion()) return
        const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
        return () => window.clearInterval(timer)
    }, [active, paused, count])
    if (count === 0) return null
    const current = Math.min(index, count - 1)
    const slide = slides[current]
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "ArrowRight") setIndex((current + 1) % count)
        else if (event.key === "ArrowLeft") setIndex((current - 1 + count) % count)
    }
    return <section className="os-cin-hero" aria-roledescription="carousel" aria-label={label} onKeyDown={onKey}
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        <div className="os-cin-hero-stage" role="group" aria-roledescription="slide" aria-label={`${current + 1} of ${count}`} style={{ "--hero-accent": slide.accent } as CSSProperties}>
            {slide.cover && <img src={slide.cover} alt="" />}
            <div className="os-cin-hero-scrim" />
            <div className="os-cin-hero-copy">
                <p className="os-cin-kicker">{slide.kicker}</p>
                <h2>{slide.title}</h2>
                <p>{slide.pitch}</p>
                {slide.tags.length > 0 && <div className="os-cin-row">{slide.tags.map((tag) => <span key={tag} className="os-cin-tag">{tag}</span>)}</div>}
                <div className="os-cin-row">
                    <button type="button" className="os-cin-btn os-cin-btn--play" onClick={slide.primary.onClick}>{slide.primary.label}</button>
                    {slide.secondary && <button type="button" className="os-cin-btn" onClick={slide.secondary.onClick}>{slide.secondary.label}</button>}
                </div>
            </div>
            {count > 1 && <div className="os-cin-dots">{slides.map((s, i) => <button key={s.id} type="button" className="os-cin-dot" aria-label={`Show slide ${i + 1}`} aria-current={i === current ? "true" : undefined} onClick={() => setIndex(i)} />)}</div>}
        </div>
        {count > 1 && <ul className="os-cin-picker" aria-label={`${label}: choose`}>
            {slides.map((s, i) => <li key={s.id}><button type="button" className="os-cin-pick" aria-current={i === current ? "true" : undefined} onClick={() => setIndex(i)}>
                <span className="os-cin-pick-art" style={{ "--pick-accent": s.accent } as CSSProperties}>{s.cover && <img src={s.cover} alt="" loading="lazy" />}</span>
                <span>{s.title}</span>
            </button></li>)}
        </ul>}
    </section>
}
