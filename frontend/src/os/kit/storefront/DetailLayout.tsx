import type { CSSProperties, ReactNode } from "react"

export function DetailLayout({ banner, accent, icon, back, title, pitch, badges, main, side }: {
    banner: string | null; accent: string; icon?: ReactNode; back: { label: string; onClick: () => void }
    title: string; pitch: string; badges?: ReactNode; main: ReactNode; side: ReactNode
}) {
    return <article className="os-cin-detail-wrap">
        <header className="os-cin-banner" style={{ "--banner-accent": accent } as CSSProperties}>
            {banner && <img src={banner} alt="" />}
            <div className="os-cin-banner-copy">
                {icon}
                <div className="os-cin-banner-title">
                    <button type="button" className="os-cin-link" onClick={back.onClick}>{back.label}</button>
                    <h1>{title}</h1>
                    <p>{pitch}</p>
                </div>
                {badges && <div className="os-cin-row os-cin-banner-badges">{badges}</div>}
            </div>
        </header>
        <div className="os-cin-detail"><div className="os-cin-main">{main}</div><aside className="os-cin-side">{side}</aside></div>
    </article>
}
