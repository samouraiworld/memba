/**
 * Window frame and window contents: Welcome, the native windows, and the
 * existing Memba page inside the window for apps whose native window isn't
 * built yet (ClassicPage).
 *
 * @module os/shell/WindowFrame
 */
import { createElement, lazy, Suspense, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { getApp, type OsAppId } from "../apps"
import { AppTile, ThingTile } from "./icons"
import type { OsSession } from "./useOsSession"
// Each app's windows load when first opened (day 7), keeping the shell chunk small.
const DaoFolder = lazy(() => import("../daos/DaoWindows").then((m) => ({ default: m.DaoFolder })))
const DaosApp = lazy(() => import("../daos/DaoWindows").then((m) => ({ default: m.DaosApp })))
const ProposalWindow = lazy(() => import("../daos/DaoWindows").then((m) => ({ default: m.ProposalWindow })))
const CreateDaoWizard = lazy(() => import("../daos/CreateDaoWizard").then((m) => ({ default: m.CreateDaoWizard })))
const ProposeWizard = lazy(() => import("../daos/ProposeWizard").then((m) => ({ default: m.ProposeWizard })))
const ClassicPage = lazy(() => import("../page/ClassicPage").then((m) => ({ default: m.ClassicPage })))
const MultisigApp = lazy(() => import("../multisig/MultisigWindows").then((m) => ({ default: m.MultisigApp })))
const MultisigWindow = lazy(() => import("../multisig/MultisigWindows").then((m) => ({ default: m.MultisigWindow })))
const SendWindow = lazy(() => import("../wallet/WalletWindows").then((m) => ({ default: m.SendWindow })))
const WalletWindow = lazy(() => import("../wallet/WalletWindows").then((m) => ({ default: m.WalletWindow })))
import { classicForSection, pageNeedsWallet } from "../page/classicRoute"
import { nativeView } from "../native/registry"
import { WindowError } from "./WindowError"
import { DOCK_ROOM, type DeskSize, type OsWindow, type WindowSpec } from "./windows"

interface Actions {
    session: OsSession
    openApp: (app: OsAppId) => void
    open: (spec: WindowSpec) => void
    close: () => void
    toast: (msg: string) => void
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

function Holding({ tile, title, text, children }: { tile: ReactNode; title: string; text: string; children?: ReactNode }) {
    return (
        <div className="os-holding">
            {tile}
            <div className="os-holding-title">{title}</div>
            <p className="os-sub">{text}</p>
            <div className="os-row">
                {children}
            </div>
        </div>
    )
}

/** What a window shows: the native window for its target, or the Memba page. Also drawn as a phone sheet. */
export function WindowBody(props: Actions & { win: OsWindow }) {
    // A window that fails (its code or its page) fails alone; lazy windows made that likelier.
    return (
        <WindowError resetKey={`${props.win.id}:${JSON.stringify(props.win.target ?? null)}`} close={props.close}>
            <Suspense fallback={<div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading…</span></div>}>
                <Body {...props} />
            </Suspense>
        </WindowError>
    )
}

function Body({ win, ...a }: Actions & { win: OsWindow }) {
    const net = a.session.network.key
    if (win.key === "welcome") return <Welcome {...a} />
    const t = win.target
    if (!t || t.kind === "unknown") {
        return (
            <Holding tile={<ThingTile icon="doc" size={44} />} title="Nothing lives here"
                text="This link doesn't open anything in Memba. Check it for typos, or start from an app.">
                <button type="button" className="os-btn" onClick={() => { a.close(); a.openApp("daos") }}>Open DAOs</button>
            </Holding>
        )
    }
    if (t.kind === "app" && t.app === "daos" && t.section === "new") return <CreateDaoWizard session={a.session} open={a.open} close={a.close} />
    if (t.kind === "app" && t.app === "daos" && t.section === null) return <DaosApp open={a.open} />
    if (t.kind === "dao") return <DaoFolder name={t.name} section={t.section} open={a.open} />
    if (t.kind === "proposal") return <ProposalWindow dao={t.dao} n={t.n} session={a.session} />
    if (t.kind === "new-proposal") return <ProposeWizard dao={t.dao} session={a.session} open={a.open} close={a.close} />
    if (t.kind === "desktop") return null
    if (t.kind === "app" && t.app === "wallet" && t.section === null) return <WalletWindow session={a.session} open={a.open} toast={a.toast} />
    if (t.kind === "app" && t.app === "wallet" && t.section === "send") return <SendWindow session={a.session} close={a.close} />
    if (t.kind === "multisig") return <MultisigWindow address={t.address} session={a.session} open={a.open} />
    if (t.kind === "app" && t.app === "multisig" && t.section === null) return <MultisigApp session={a.session} open={a.open} />
    if (t.kind === "feedback") return <ClassicPage key={`${win.id}:feedback`} network={net} page="feedback" layout={a.session.layout} />
    // Keyed by the page too: a window that follows a link to another page (tx 7 → tx 12)
    // must start that page fresh, never carry the previous page's typed state over.
    // Its query isn't in the key: a tab change is the same page, which re-renders in place.
    const classicPage = classicForSection(t.app, t.section)
    const classicEl = classicPage === null ? null : <ClassicPage key={`${win.id}:${classicPage}`} network={net} page={classicPage} query={t.query} layout={a.session.layout} />
    const native = nativeView(t.app)
    if (native) {
        return createElement(native, { section: t.section, query: t.query, session: a.session, open: a.open, openApp: a.openApp, close: a.close, toast: a.toast, classic: classicEl })
    }
    if (classicPage === null) {
        const app = getApp(t.app)
        return t.section === null
            ? <Holding tile={<AppTile app={t.app} size={44} />} title={app.name} text={`${app.summary}. Coming to Memba OS in a later version.`} />
            : (
                <Holding tile={<AppTile app={app.id} size={44} />} title="Nothing lives here" text={`${app.name} has no page at this address.`}>
                    <button type="button" className="os-btn" onClick={() => a.openApp(app.id)}>Open {app.name}</button>
                </Holding>
            )
    }
    if (pageNeedsWallet(classicPage) && a.session.status !== "member") {
        const app = getApp(t.app)
        return (
            <Holding tile={<AppTile app={app.id} size={44} />} title={app.name} text={`Connect a wallet to use ${app.name}.`}>
                <button type="button" className="os-btn" onClick={a.session.openConnect}>Connect</button>
            </Holding>
        )
    }
    return classicEl
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

    // Keyboard users follow the front window: focus moves into it when it comes to the front,
    // unless focus is already inside it or in a modal (review sheet, connect, lock screen).
    useEffect(() => {
        const el = ref.current
        if (!active || !el) return
        const cur = document.activeElement
        if (cur && (el.contains(cur) || cur.closest('[aria-modal="true"]'))) return
        el.focus({ preventScroll: true })
    }, [active])

    return (
        <section ref={ref} className={`os-win os-glass${active ? "" : " os-inactive"}${win.max ? " os-max" : ""}`} style={style}
            aria-label={win.title} data-win={win.key} tabIndex={-1} onPointerDown={() => { if (!active) frame.focus(win.id) }}>
            <div className="os-tb" onPointerDown={(e) => begin("move", e)} {...handlers} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) frame.toggleMax(win.id) }}>
                <span className="os-lights">
                    <button type="button" className="os-light-close" aria-label={`Close ${win.title}`} onClick={() => frame.close(win.id)}><span aria-hidden="true">×</span></button>
                    <button type="button" className="os-light-min" aria-label={`Minimise ${win.title}`} onClick={() => frame.minimise(win.id)}><span aria-hidden="true">–</span></button>
                    <button type="button" className="os-light-max" aria-label={`${win.max ? "Restore" : "Maximise"} ${win.title}`} aria-pressed={win.max} onClick={() => frame.toggleMax(win.id)}><span aria-hidden="true">+</span></button>
                </span>
                <h2 className="os-tb-title">{win.title}</h2>
            </div>
            <div className="os-wbody"><WindowBody win={win} {...a} close={() => frame.close(win.id)} /></div>
            {!win.max && <span className="os-rz" aria-hidden="true" data-testid="resize" onPointerDown={(e) => begin("resize", e)} {...handlers} />}
        </section>
    )
}
