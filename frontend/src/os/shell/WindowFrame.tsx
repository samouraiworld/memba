/**
 * Window frame and the day-2 window contents: Welcome, and a holding window
 * for apps and links whose native window isn't built yet (it points to the
 * same page in the current Memba).
 *
 * @module os/shell/WindowFrame
 */
import type { CSSProperties, ReactNode } from "react"
import { getApp, type OsAppId } from "../apps"
import { classicPath } from "./format"
import { AppTile, ThingTile } from "./icons"
import type { OsSession } from "./useOsSession"
import type { OsWindow } from "./windows"

interface Actions {
    session: OsSession
    openApp: (app: OsAppId) => void
    close: () => void
}

function Welcome({ session, openApp }: Actions) {
    return (
        <div className="os-welcome">
            <div>
                <div className="os-welcome-title">Your desk on gno.land.</div>
                <p className="os-sub os-welcome-sub">
                    Memba is where DAOs, multisigs and people on gno.land get things done. You're a guest, so you can open and
                    read everything. Connect a wallet when you want to vote, sign or post.
                </p>
            </div>
            <div className="os-opts">
                <button type="button" onClick={() => openApp("daos")}><AppTile app="daos" size={34} /><b>Explore DAOs</b><span className="os-sub">See what communities are deciding</span></button>
                <button type="button" onClick={() => openApp("arcade")}><AppTile app="arcade" size={34} /><b>Play</b><span className="os-sub">Games with on-chain scores</span></button>
                <button type="button" onClick={session.openConnect}><AppTile app="wallet" size={34} /><b>Connect wallet</b><span className="os-sub">Vote, sign, post and keep your desk</span></button>
            </div>
        </div>
    )
}

function Holding({ tile, title, text, href, linkLabel, children }: { tile: ReactNode; title: string; text: string; href: string | null; linkLabel: string; children?: ReactNode }) {
    return (
        <div className="os-holding">
            {tile}
            <div className="os-holding-title">{title}</div>
            <p className="os-sub">{text}</p>
            <div className="os-row">
                {href !== null && <a className="os-btn os-ghost" href={href}>{linkLabel}</a>}
                {children}
            </div>
        </div>
    )
}

function Body({ win, ...a }: Actions & { win: OsWindow }) {
    const net = a.session.network.key
    const guest = a.session.status !== "member"
    if (win.key === "welcome") return <Welcome {...a} />
    const t = win.target
    if (!t || t.kind === "unknown") {
        return (
            <Holding tile={<ThingTile icon="doc" size={44} />} title="Nothing lives here" href={null} linkLabel=""
                text="This link doesn't open anything in Memba. Check it for typos, or start from an app.">
                <button type="button" className="os-btn" onClick={() => { a.close(); a.openApp("daos") }}>Open DAOs</button>
            </Holding>
        )
    }
    if (t.kind === "app") {
        const app = getApp(t.app)
        const path = classicPath(t.app)
        return (
            <Holding tile={<AppTile app={t.app} size={44} />} title={app.name} linkLabel={`Open ${app.name} in Memba`}
                href={path === null ? null : `/${net}/${path}`}
                text={path === null ? `${app.summary}. Coming to Memba OS in a later version.` : `${app.summary}. Its window is on the way; until then it opens as the current Memba page.`} />
        )
    }
    const connect = guest && t.kind !== "multisig"
        ? <button type="button" className="os-btn" onClick={a.session.openConnect}>Connect to vote</button>
        : null
    if (t.kind === "multisig") {
        return (
            <Holding tile={<AppTile app="multisig" size={44} />} title={win.title} linkLabel="Open multisigs in Memba" href={`/${net}/multisig`}
                text="Multisig windows are on the way. Until then, find this account in the current Memba." />
        )
    }
    return (
        <Holding tile={<ThingTile icon={t.kind === "proposal" ? "doc" : "folder"} tint={t.kind === "dao" ? ["#5B7CFA", "#3D5BE0"] : undefined} size={44} />}
            title={win.title} linkLabel="Browse DAOs in Memba" href={`/${net}/dao`}
            text={t.kind === "proposal" ? "Proposals will open right here. Until then, find it from the DAO list." : "DAO folders will open right here. Until then, find it from the DAO list."}>
            {connect}
        </Holding>
    )
}

export function WindowFrame({ win, index, active, onFocus, onClose, ...a }: Omit<Actions, "close"> & {
    win: OsWindow
    index: number
    active: boolean
    onFocus: () => void
    onClose: () => void
}) {
    const style = {
        "--os-w": `${win.width}px`,
        "--os-h": `${win.height}px`,
        "--os-off": `${(index % 6) * 26}px`,
        zIndex: 10 + win.z,
    } as CSSProperties
    return (
        <section className={`os-win os-glass${active ? "" : " os-inactive"}`} style={style} aria-label={win.title} onPointerDown={onFocus} data-win={win.key}>
            <div className="os-tb">
                <span className="os-lights">
                    <button type="button" className="os-light-close" aria-label={`Close ${win.title}`} onClick={onClose}><span aria-hidden="true">×</span></button>
                    <span className="os-light-min" aria-hidden="true" />
                    <span className="os-light-max" aria-hidden="true" />
                </span>
                <h2 className="os-tb-title">{win.title}</h2>
            </div>
            <div className="os-wbody"><Body win={win} {...a} close={onClose} /></div>
        </section>
    )
}
