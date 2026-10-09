import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { safeLink } from "./client"
import { radioPlayer } from "./player"
import "./radio.css"

export interface RadioWidgetActions { onHide: () => void; onStop: () => void }
function Glyph({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
}
export function RadioWidget({ onHide, onStop }: RadioWidgetActions) {
    const s = useSyncExternalStore(radioPlayer.subscribe, radioPlayer.snapshot)
    const [expanded, setExpanded] = useState(false)
    const root = useRef<HTMLElement>(null)
    const more = useRef<HTMLButtonElement>(null)
    const detailsId = useId()
    const cover = safeLink(s.track?.cover ?? "")
    const source = safeLink(s.track?.source ?? "")
    const station = s.stations.find(st => st.id === s.station)?.name ?? "Main"
    const retry = Boolean(s.error) && !s.playing && !s.busy
    const subtitle = s.busy ? s.status : s.playing ? `${s.track?.artistName || "Live"} · ${station}`
        : retry ? "Could not load · Retry" : s.track ? `Paused · ${s.track.artistName || station}`
            : s.status === "Choose Play to join the live station." ? "Ready when you are" : s.status
    useEffect(() => {
        if (!expanded) return
        const focus = requestAnimationFrame(() => root.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true }))
        const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setExpanded(false) }
        const escape = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return
            e.preventDefault(); setExpanded(false); more.current?.focus()
        }
        window.addEventListener("pointerdown", outside)
        window.addEventListener("keydown", escape)
        return () => { cancelAnimationFrame(focus); window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape) }
    }, [expanded])
    const finish = (action: () => void) => {
        action()
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Show Radio"]')?.focus({ preventScroll: true }))
    }
    const disclosure = { "aria-expanded": expanded, "aria-controls": detailsId, onClick: () => setExpanded(v => !v) }
    return <section ref={root} className="os-radio-widget" aria-label="Radio player" data-playing={s.playing || undefined} data-error={retry || undefined}>
        {expanded && <div className="os-radio-details" id={detailsId} role="region" aria-label="Radio controls">
            <header><strong>Gno Radio</strong><span className="os-radio-network">Onyx testnet</span></header>
            <label className="os-radio-station"><span>Station</span><select aria-label="Station" value={s.station} onChange={e => radioPlayer.station(Number(e.target.value))}>
                {s.stations.length ? s.stations.map(st => <option key={st.id} value={st.id}>{st.name}</option>) : <option value={0}>Main</option>}
            </select></label>
            <div className="os-radio-volume">
                <button type="button" aria-label={s.volume === 0 ? "Unmute radio" : "Mute radio"} onClick={radioPlayer.mute}><Glyph><path d="M11 4 5 9H2v6h3l6 5z" />{s.volume ? <path d="M15 8c2 2 2 6 0 8M18 4c4 4 4 12 0 16" /> : <path d="m16 9 6 6m0-6-6 6" />}</Glyph></button>
                <input aria-label="Radio volume" type="range" min="0" max="1" step=".01" value={s.volume} onChange={e => radioPlayer.volume(Number(e.target.value))} />
                <span aria-hidden="true">{Math.round(s.volume * 100)}</span>
            </div>
            {s.error && <p className="os-radio-error" role="alert">{s.error}</p>}
            {s.track && <p className="os-radio-credit">{s.track.attribution || s.track.license}{source && <> · <a href={source} target="_blank" rel="noopener noreferrer">Track source</a></>}</p>}
            <footer><nav aria-label="Radio links"><a href="https://gnoradio.xyz/about" target="_blank" rel="noopener noreferrer">Governance</a><a href="https://github.com/alexiscolin/gnoradio" target="_blank" rel="noopener noreferrer">Source</a></nav>
                <button type="button" onClick={() => finish(onHide)}>Hide widget</button>
            </footer>
            <button type="button" className="os-radio-stop" onClick={() => finish(onStop)}>Stop radio</button>
        </div>}
        <div className="os-radio-bar">
            <button type="button" className="os-radio-art" aria-label="Open radio controls" {...disclosure}>
                <Glyph><path d="M9 17V6l11-2v11M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2.5" /><ellipse cx="17" cy="16" rx="3" ry="2.5" /></Glyph>
                {cover && <img key={cover} src={cover} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.visibility = "hidden" }} />}
            </button>
            <div className="os-radio-text"><span className="os-radio-title" title={s.track?.title || "Gno Radio"}>{s.track?.title || "Gno Radio"}</span><span className="os-radio-subtitle" role="status" title={subtitle}><i aria-hidden="true" />{subtitle}</span></div>
            <button type="button" className="os-radio-play" disabled={!s.ready} aria-label={s.playing || s.busy ? "Pause radio" : retry ? "Retry radio" : "Play radio"} onClick={radioPlayer.toggle}>
                {s.playing || s.busy ? <Glyph fill><rect x="5" y="4" width="5" height="16" rx="1.4" /><rect x="14" y="4" width="5" height="16" rx="1.4" /></Glyph>
                    : retry ? <Glyph><path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6" /></Glyph>
                        : <Glyph fill><path d="M7 4.5c0-1 1-1.5 1.8-1l12 7.1c1 .6 1 2.2 0 2.8l-12 7.1c-.8.5-1.8 0-1.8-1z" /></Glyph>}
            </button>
            <button ref={more} type="button" className="os-radio-more" aria-label="Radio controls" {...disclosure}><Glyph><circle cx="4" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="20" cy="12" r="1" /></Glyph></button>
        </div>
    </section>
}
