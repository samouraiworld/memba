import { useSyncExternalStore } from "react"
import type { NativeViewProps } from "../../native/types"
import { safeLink } from "./client"
import { radioPlayer } from "./player"
import "./radio.css"

export default function RadioWindow({ section, fallback }: NativeViewProps) {
    const s = useSyncExternalStore(radioPlayer.subscribe, radioPlayer.snapshot)
    if (section !== null) return fallback
    const cover = safeLink(s.track?.cover ?? "")
    const source = safeLink(s.track?.source ?? "")
    return <section className="os-radio" aria-label="Radio player">
        <header><span className="os-radio-signal" data-playing={s.playing || undefined} /><span>Onyx testnet</span><span className="os-sub">Listening is free</span></header>
        <div className="os-radio-record" aria-hidden="true">{cover ? <img key={cover} src={cover} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.visibility = "hidden" }} /> : <span>♫</span>}</div>
        <div className="os-radio-title"><h3>{s.track?.title ?? "Your desk, with a soundtrack"}</h3><p className="os-sub">{s.track?.artistName || "Tune in to Gno Radio"}</p></div>
        <label className="os-radio-station">Station<select aria-label="Station" value={s.station} onChange={e => radioPlayer.station(Number(e.target.value))}>{s.stations.length ? s.stations.map(st => <option key={st.id} value={st.id}>{st.name}</option>) : <option value={0}>Main</option>}</select></label>
        <div className="os-radio-controls">
            <button type="button" className="os-btn os-radio-play" disabled={!s.ready} aria-label={s.playing || s.busy ? "Pause radio" : "Play radio"} onClick={radioPlayer.toggle}>{s.playing || s.busy ? "Ⅱ" : "▶"}</button>
            <button type="button" className="os-btn os-quiet" aria-label={s.volume === 0 ? "Unmute radio" : "Mute radio"} onClick={() => radioPlayer.volume(s.volume ? 0 : .65)}>{s.volume === 0 ? "Muted" : "Volume"}</button>
            <input aria-label="Radio volume" type="range" min="0" max="1" step=".01" value={s.volume} onChange={e => radioPlayer.volume(Number(e.target.value))} />
        </div>
        <p className="os-radio-status os-sub" role="status">{s.status}</p>
        {s.error && <p className="os-note os-warn" role="alert">{s.error}</p>}
        {s.track && <p className="os-radio-credit os-sub">{s.track.attribution || s.track.license}{source && <> · <a href={source} target="_blank" rel="noopener noreferrer">Track source</a></>}</p>}
        <footer><a href="https://gnoradio.xyz" target="_blank" rel="noopener noreferrer">Gno Radio</a><a href="https://gnoradio.xyz/about" target="_blank" rel="noopener noreferrer">Governance &amp; rules</a><a href="https://github.com/alexiscolin/gnoradio" target="_blank" rel="noopener noreferrer">Source</a></footer>
    </section>
}
