/**
 * Window frame and window contents: Welcome, and a holding window
 * for apps and links whose native window isn't built yet (it points to the
 * same page in the current Memba).
 *
 * @module os/shell/WindowFrame
 */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { getApp, type OsAppId } from "../apps"
import { classicPath } from "./format"
import { AppTile, ThingTile } from "./icons"
import type { OsSession } from "./useOsSession"
import { DaoFolder, DaosApp, ProposalWindow } from "../daos/DaoWindows"
import { DOCK_ROOM, type DeskSize, type OsWindow, type WindowSpec } from "./windows"

interface Actions {
    session: OsSession
    openApp: (app: OsAppId) => void
    open: (spec: WindowSpec) => void
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
    if (t.kind === "app" && t.app === "daos") return <DaosApp open={a.open} />
    if (t.kind === "dao") return <DaoFolder name={t.name} section={t.section} open={a.open} />
    if (t.kind === "proposal") return <ProposalWindow dao={t.dao} n={t.n} session={a.session} />
    if (t.kind === "app") {
        const app = getApp(t.app)
        const path = classicPath(t.app)
        return (
            <Holding tile={<AppTile app={t.app} size={44} />} title={app.name} linkLabel={`Open ${app.name} in Memba`}
                href={path === null ? null : `/${net}/${path}`}
                text={path === null ? `${app.summary}. Coming to Memba OS in a later version.` : `${app.summary}. Its window is on the way; until then it opens as the current Memba page.`} />
        )
    }
    if (t.kind === "multisig") {
        return (
            <Holding tile={<AppTile app="multisig" size={44} />} title={win.title} linkLabel="Open multisigs in Memba" href={`/${net}/multisig`}
                text="Multisig windows are on the way. Until then, find this account in the current Memba." />
        )
    }
    return null
}

export interface FrameActions {
    focus: (id: string) => void
    close: (id: string) => void
    minimise: (id: string) => void
    toggleMax: (id: string) => void
    move: (id: string, x: number, y: number) => void
    resize: (id: string, width: number, height: number) => void
}

type Drag = { mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; moved: boolean }

/**
 * A window: title bar (drag to move, double-click to maximise), traffic
 * lights (close, minimise to the dock, maximise), resize corner. While
 * dragging, the frame moves through its own style and commits on release, so
 * the window's content doesn't re-render on every pointer move.
 */
export function WindowFrame({ win, active, desk, frame, ...a }: Omit<Actions, "close"> & {
    win: OsWindow
    active: boolean
    desk: DeskSize
    frame: FrameActions
}) {
    const ref = useRef<HTMLElement>(null)
    const drag = useRef<Drag | null>(null)
    const g = win.max
        ? { x: 8, y: 6, width: Math.max(0, desk.w - 16), height: Math.max(0, desk.h - 6 - DOCK_ROOM) }
        : { x: win.x, y: win.y, width: win.width, height: win.height }
    const style = { left: g.x, top: g.y, width: g.width, height: g.height, zIndex: 10 + win.z } as CSSProperties

    const begin = (mode: Drag["mode"], e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return
        if (mode === "move" && (win.max || (e.target as HTMLElement).closest("button"))) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: g.x, oy: g.y, ow: g.width, oh: g.height, moved: false }
    }
    const onMove = (e: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current
        const el = ref.current
        if (!d || !el) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (!d.moved && Math.hypot(dx, dy) < 3) return
        d.moved = true
        if (d.mode === "move") { el.style.left = `${d.ox + dx}px`; el.style.top = `${Math.max(0, d.oy + dy)}px` }
        else { el.style.width = `${Math.max(320, d.ow + dx)}px`; el.style.height = `${Math.max(220, d.oh + dy)}px` }
    }
    const end = (e: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current
        drag.current = null
        if (!d?.moved) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        // Put the frame back where React last rendered it: if the reducer clamps
        // the drop to the old geometry, React sees no change and wouldn't undo
        // the live offset.
        const el = ref.current
        if (el) Object.assign(el.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.width}px`, height: `${g.height}px` })
        if (d.mode === "move") frame.move(win.id, d.ox + dx, d.oy + dy)
        else frame.resize(win.id, d.ow + dx, d.oh + dy)
    }
    const handlers = { onPointerMove: onMove, onPointerUp: end, onPointerCancel: end }

    return (
        <section ref={ref} className={`os-win os-glass${active ? "" : " os-inactive"}${win.max ? " os-max" : ""}`} style={style}
            aria-label={win.title} data-win={win.key} onPointerDown={() => { if (!active) frame.focus(win.id) }}>
            <div className="os-tb" onPointerDown={(e) => begin("move", e)} {...handlers} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) frame.toggleMax(win.id) }}>
                <span className="os-lights">
                    <button type="button" className="os-light-close" aria-label={`Close ${win.title}`} onClick={() => frame.close(win.id)}><span aria-hidden="true">×</span></button>
                    <button type="button" className="os-light-min" aria-label={`Minimise ${win.title}`} onClick={() => frame.minimise(win.id)}><span aria-hidden="true">–</span></button>
                    <button type="button" className="os-light-max" aria-label={`${win.max ? "Restore" : "Maximise"} ${win.title}`} aria-pressed={win.max} onClick={() => frame.toggleMax(win.id)}><span aria-hidden="true">+</span></button>
                </span>
                <h2 className="os-tb-title">{win.title}</h2>
            </div>
            <div className="os-wbody"><Body win={win} {...a} close={() => frame.close(win.id)} /></div>
            {!win.max && <span className="os-rz" aria-hidden="true" data-testid="resize" onPointerDown={(e) => begin("resize", e)} {...handlers} />}
        </section>
    )
}
