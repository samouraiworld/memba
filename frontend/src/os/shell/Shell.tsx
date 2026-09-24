/**
 * The Memba OS shell: entry logic (D7), menu bar, windows, desktop items,
 * dock, connect flow. The address bar follows the windows (front window's
 * path + ?w= for the others) and a link opens its windows; a plain /os visit
 * restores this browser's last windows.
 *
 * @module os/shell/Shell
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router-dom"
import type { OsAppId } from "../apps"
import { ConnectModal } from "./ConnectModal"
import { itemTarget } from "./desk"
import { ContextMenu, DeskItems, type MenuEntry } from "./DeskItems"
import { Dock } from "./Dock"
import { markSeen, readSeen, resolveEntry, type OsEntry } from "./entry"
import { shortAddr } from "./format"
import { LockScreen } from "./LockScreen"
import { MenuBar } from "./MenuBar"
import { takeNetworkSwitchNotice } from "./network"
import type { OsTarget } from "./osPath"
import { loadSavedTargets, saveWindows, targetsFromUrl, urlForWindows, windowToken } from "./urlSync"
import { useDesk } from "./useDesk"
import { useOsSession } from "./useOsSession"
import { SignerProvider } from "../sign/SignerProvider"
import { Launcher } from "./Launcher"
import { WindowFrame, type FrameActions } from "./WindowFrame"
import {
    appSpec, EMPTY_WINDOWS, newDaoSpec, specForTarget, useWindows, visibleWindows, welcomeSpec, windowsReducer,
    type DeskSize, type OsWindow, type WindowSpec, type WindowsState,
} from "./windows"

const TOAST_MS = 2600
const MENU_BAR = 30

/** First guess before the desk is measured (the ResizeObserver corrects it). */
function initialDesk(): DeskSize {
    const root = document.documentElement
    return { w: root.clientWidth, h: Math.max(0, root.clientHeight - MENU_BAR) }
}

/** The windows a link opens: its ?w= windows first, the path's window last (so on top). */
function openTargets(s: WindowsState, front: OsTarget, others: OsTarget[], desk: DeskSize): WindowsState {
    const specs = [...others, front].map(specForTarget).filter((x): x is WindowSpec => x !== null)
    return specs.reduce((acc, spec, i) => windowsReducer(acc, { type: "open", spec, desk, center: specs.length === 1 && i === 0 }), s)
}

function arrivalWindows(arrival: ReturnType<typeof targetsFromUrl>, fromLink: boolean, entry: OsEntry, desk: DeskSize): WindowsState {
    const saved = entry === "lock" ? [] : loadSavedTargets()
    if (fromLink) {
        // A link decides which windows open; where this browser had the same
        // window before (a reload), it keeps the position and size it had.
        const s = openTargets(EMPTY_WINDOWS, arrival.front, arrival.others, desk)
        const geomByToken = new Map(saved.map(({ target, geom }) => [windowToken(target), geom]))
        return {
            ...s,
            wins: s.wins.map((w) => {
                const g = geomByToken.get(windowToken(w.target))
                return g ? { ...w, x: g.x, y: g.y, width: g.width, height: g.height, max: g.max } : w
            }),
        }
    }
    if (entry === "lock") return EMPTY_WINDOWS
    const wins: OsWindow[] = saved.flatMap(({ target, geom }, i) => {
        const spec = specForTarget(target)
        return spec ? [{ ...spec, ...geom, id: `w${i + 1}` }] : []
    })
    return windowsReducer(EMPTY_WINDOWS, { type: "restore", wins })
}

export function Shell() {
    const location = useLocation()
    const navigate = useNavigate()

    // ── desk size (windows and items are placed in it) ──
    const deskRef = useRef<HTMLElement>(null)
    const [desk, setDesk] = useState<DeskSize>(initialDesk)
    const deskNow = useRef(desk)
    useEffect(() => {
        const el = deskRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(() => {
            const next = { w: el.clientWidth, h: el.clientHeight }
            deskNow.current = next
            setDesk(next)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // ── toast ──
    const [toast, setToast] = useState<string | null>(null)
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const showToast = useCallback((msg: string) => {
        setToast(msg)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
    }, [])
    useEffect(() => () => clearTimeout(toastTimer.current), [])

    // ── arrival: decided once ──
    const [arrival] = useState(() => targetsFromUrl(location.pathname, location.search))
    const fromLink = arrival.front.kind !== "desktop" || arrival.others.length > 0

    const session = useOsSession({
        onSignedIn: (address) => {
            win.closeKey("welcome")
            setLinkGuest(false)
            showToast(`Connected with Adena · ${shortAddr(address)}`)
        },
    })
    const [entry] = useState(() => resolveEntry({ seen: readSeen(), resuming: session.status === "resuming", deepLink: fromLink }))
    const [locked, setLocked] = useState(entry === "lock")
    const [linkGuest, setLinkGuest] = useState(entry === "link")

    const win = useWindows(() => arrivalWindows(arrival, fromLink, entry, deskNow.current))
    const { dispatch } = win

    useEffect(() => {
        if (entry !== "lock") markSeen()
        const switched = takeNetworkSwitchNotice()
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot notice read from sessionStorage after a switch reload
        if (switched) showToast(switched)
    }, [entry, showToast])

    const wasResuming = useRef(session.status === "resuming")
    useEffect(() => {
        if (!wasResuming.current || session.status === "resuming") return
        wasResuming.current = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to the wallet finishing its silent reconnect
        if (session.status === "member") showToast("Welcome back · session resumed")
    }, [session.status, showToast])

    // ── windows ⇄ URL, and the saved session ──
    /** The URL we last wrote (or arrived at). */
    const lastUrl = useRef(location.pathname + location.search)
    /** The location the reader last looked at. */
    const seenUrl = useRef(location.pathname + location.search)
    const here = location.pathname + location.search
    const navType = useNavigationType()
    useEffect(() => {
        // A navigation we didn't write: a link opens its windows on top; back/forward
        // (POP) returns to exactly the windows that URL lists. Only a location that
        // changed since the last look counts (StrictMode runs effects twice), and
        // not our own replace.
        if (here === seenUrl.current) return
        seenUrl.current = here
        if (here === lastUrl.current) return
        lastUrl.current = here
        const t = targetsFromUrl(location.pathname, location.search)
        const specs = [...t.others, t.front].map(specForTarget).filter((x): x is WindowSpec => x !== null)
        dispatch({ type: "navigate", specs, desk: deskNow.current, exact: navType === "POP" })
    }, [here, location.pathname, location.search, navType, dispatch])
    // Declared after the reader on purpose: effects run in order, and the reader
    // must see the URL before this one replaces it, or it would take the old URL
    // for a back/forward navigation.
    useEffect(() => {
        saveWindows(win.wins)
        const url = urlForWindows(win.wins)
        lastUrl.current = url
        if (url !== window.location.pathname + window.location.search) navigate(url, { replace: true })
    }, [win.wins, navigate])

    // ── actions ──
    const open = useCallback((spec: WindowSpec, center = false) => dispatch({ type: "open", spec, desk: deskNow.current, center }), [dispatch])
    const openApp = useCallback((app: OsAppId) => open(appSpec(app)), [open])
    const move = useCallback((id: string, x: number, y: number) => dispatch({ type: "move", id, x, y, desk: deskNow.current }), [dispatch])
    const resize = useCallback((id: string, width: number, height: number) => dispatch({ type: "resize", id, width, height, desk: deskNow.current }), [dispatch])
    const frame: FrameActions = { focus: win.focus, close: win.close, minimise: win.minimise, toggleMax: win.toggleMax, move, resize }
    const tile = useCallback(() => dispatch({ type: "tile", desk: deskNow.current }), [dispatch])

    const member = session.status === "member"
    const deskOwner = session.status === "resuming" ? undefined : member ? session.address : null
    const deskItems = useDesk(deskOwner)

    const unlock = () => { setLocked(false); markSeen() }
    const lock = () => {
        if (member) session.disconnect()
        win.closeAll()
        setLinkGuest(false)
        setLocked(true)
    }

    // ── ⌥ shortcuts (D13) ──
    const front = win.front
    const { close: closeWin, next: nextWin } = win
    const [launcher, setLauncher] = useState(false)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // ⌘K / Ctrl+K opens search, from anywhere (D13).
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !locked && !session.stage) { e.preventDefault(); setLauncher((v) => !v); return }
            if (locked || session.stage || !e.altKey) return
            const t = e.target as HTMLElement | null
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
            if (e.code === "KeyW" && front) { e.preventDefault(); closeWin(front.id) }
            else if (e.code === "Backquote") { e.preventDefault(); nextWin() }
            else if (e.code === "KeyF" && front) {
                // ⌥F: the front window full screen and back (D32: every game has a full-screen mode).
                e.preventDefault()
                if (document.fullscreenElement) void document.exitFullscreen()
                else void document.querySelector<HTMLElement>(`[data-win="${CSS.escape(front.key)}"]`)?.requestFullscreen?.()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [locked, session.stage, front, closeWin, nextWin])

    // ── right-click menus ──
    const [menu, setMenu] = useState<{ x: number; y: number; item: number | null } | null>(null)
    const [startRequest, setStartRequest] = useState(0)
    const closeMenu = useCallback(() => setMenu(null), [])
    const openMenu = (e: ReactMouseEvent, item: number | null) => {
        const r = deskRef.current?.getBoundingClientRect()
        if (!r) return
        setMenu({ x: Math.min(e.clientX - r.left, r.width - 240), y: Math.min(e.clientY - r.top, r.height - 200), item })
    }
    const openItem = (i: number) => {
        const t = itemTarget(deskItems.items[i])
        const spec = t && specForTarget(t)
        if (spec) open(spec)
    }
    let menuEntries: (MenuEntry | "sep")[] = []
    if (menu && menu.item !== null) {
        const i = menu.item
        menuEntries = [{ label: "Open", run: () => openItem(i) }, "sep", { label: "Remove from desktop", run: () => deskItems.unpin(i) }]
    } else if (menu) {
        menuEntries = [
            { label: "Change wallpaper…", run: () => openApp("settings") },
            { label: "Add an app…", run: () => setStartRequest((n) => n + 1) },
            { label: "Clean up icons", run: deskItems.tidy },
            "sep",
            { label: "Show desktop", run: win.minimiseAll },
        ]
    }

    const visible = visibleWindows(win.wins)
    return (
        <SignerProvider session={session} toast={showToast}>
            <MenuBar session={session} wins={win.wins} front={front} openApp={openApp} openSpec={open} focusWin={win.focus} closeWin={win.close}
                closeAll={win.closeAll} minimiseAll={win.minimiseAll} tile={tile} nextWin={win.next} lock={lock} toast={showToast}
                isPinned={deskItems.isPinned} pin={deskItems.pin} startRequest={startRequest} openSearch={() => setLauncher(true)} />
            <main ref={deskRef} className="os-desk" aria-label="Desktop"
                onContextMenu={(e) => { if (e.target === e.currentTarget && !locked) { e.preventDefault(); openMenu(e, null) } }}>
                <DeskItems items={deskItems.items} deskWidth={desk.w} onOpen={openItem} onMove={deskItems.move} onMenu={openMenu} />
                {member && deskItems.items.length === 0 && visible.length === 0 && (
                    <div className="os-getstarted os-glass">
                        <div className="os-getstarted-title">Your desk is empty — let's fill it.</div>
                        <div className="os-sub">Anything you join or bookmark appears here as an icon.</div>
                        <div className="os-g2">
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("daos")}>Join a DAO</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => open(newDaoSpec())}>Create a DAO</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("multisig")}>Set up a multisig</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("arcade")}>Play a game</button>
                        </div>
                    </div>
                )}
                {visible.map((w) => (
                    <WindowFrame key={w.id} win={w} active={w.id === front?.id} desk={desk} frame={frame} session={session} openApp={openApp} open={open} toast={showToast} />
                ))}
                {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries} onClose={closeMenu} />}
                {launcher && <Launcher network={session.network.key} open={(spec) => open(spec, false)} onClose={() => setLauncher(false)} />}
            </main>
            {linkGuest && !member && (
                <div className="os-banner os-glass" role="status">
                    Browsing as guest
                    <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
                </div>
            )}
            <Dock wins={win.wins} openApp={openApp} restore={win.focus} />
            <ConnectModal session={session} />
            {toast && <div className="os-toast os-glass" role="status">{toast}</div>}
            {locked && (
                <LockScreen
                    onConnect={() => { unlock(); session.openConnect() }}
                    onGuest={() => { unlock(); open(welcomeSpec(), true) }}
                />
            )}
        </SignerProvider>
    )
}
