/**
 * The Memba OS shell: entry logic (D7), menu bar, windows, desktop items,
 * dock, connect flow. The address bar follows the windows (front window's
 * path + ?w= for the others) and a link opens its windows; a plain /os visit
 * restores this browser's last windows.
 *
 * @module os/shell/Shell
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router-dom"
import { OS_APPS, type OsAppId } from "../apps"
import { ConnectModal } from "./ConnectModal"
import { itemTarget } from "./desk"
import { ContextMenu, DeskItems, type MenuEntry } from "./DeskItems"
import { Dock } from "./Dock"
import { markLocked, readLocked, resolveEntry } from "./entry"
import { shortAddr } from "./format"
import { LockScreen } from "./LockScreen"
import { BootScreen } from "../boot/BootScreen"
import { bootLines, shouldBoot } from "../boot/boot"
import { readSkipIntro, useLiveWidget } from "../preferences"
import { MenuBar } from "./MenuBar"
import { takeNetworkSwitchNotice } from "./network"
import type { OsTarget } from "./osPath"
import { loadSavedTargets, saveWindows, targetsFromUrl, urlForWindows, windowToken, windowsStorageKey } from "./urlSync"
import { useDesk } from "./useDesk"
import { useOsSession } from "./useOsSession"
import { SignerProvider } from "../sign/SignerProvider"
import { setWalletActionGuard } from "../../lib/grc20"
import { PhoneShell } from "../phone/PhoneShell"
import { LiveTicker } from "../apps/live/LiveTicker"
import { LiveActivityProvider } from "../apps/live/LiveProvider"
import { Launcher } from "./Launcher"
import { WindowFrame, type FrameActions } from "./WindowFrame"
import { MeetStage } from "../apps/meet/MeetStage"
import { normaliseRoomId } from "../apps/meet/rooms"
import { MeetStageContext } from "../apps/meet/stageContext"
import {
    appSpec, EMPTY_WINDOWS, newDaoSpec, specForTarget, useWindows, visibleWindows, welcomeSpec, windowsReducer,
    type DeskSize, type OsWindow, type WindowSpec, type WindowsState,
} from "./windows"

const TOAST_MS = 2600
const MENU_BAR = 30
/** The guest banner (`.os-banner`: 40 px from the top, about 36 px tall) seen from the desk, plus a gap:
 * windows placed while it shows start below it, so it never covers their title bar. */
const BANNER_ROOM = 52
const PHONE_LAYOUT_QUERY = "(max-width: 768px), (max-width: 1100px) and (max-height: 500px)"
const LOCAL_UI_RESET_REVISION_KEY = "memba_os_ui_reset_revision"

function subscribePhoneLayout(onChange: () => void): () => void {
    const query = window.matchMedia(PHONE_LAYOUT_QUERY)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
}

function phoneLayout(): boolean {
    return window.matchMedia(PHONE_LAYOUT_QUERY).matches
}

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

function arrivalWindows(arrival: ReturnType<typeof targetsFromUrl>, fromLink: boolean, desk: DeskSize, storageOwner: string | null, explicitlyLocked: boolean): WindowsState {
    const saved = explicitlyLocked || storageOwner === null ? [] : loadSavedTargets(storageOwner)
    if (fromLink) {
        // A link decides which windows open; where this browser had the same
        // window before (a reload), it keeps the position and size it had.
        const s = openTargets(EMPTY_WINDOWS, arrival.front, arrival.others, desk)
        const savedByToken = new Map(saved.map((item) => [windowToken(item.target), item]))
        return {
            ...s,
            wins: s.wins.map((w) => {
                const item = savedByToken.get(windowToken(w.target))
                if (!item) return w
                const { geom, target } = item
                // The front URL's query is authoritative. A background ?w=
                // token has no query, so recover its saved page state.
                const restoredTarget = w.target?.kind === "app" && w.target.query === undefined && target.kind === "app"
                    ? target : w.target
                return { ...w, target: restoredTarget, x: geom.x, y: geom.y, width: geom.width, height: geom.height, max: geom.max }
            }),
        }
    }
    const wins: OsWindow[] = saved.flatMap(({ target, geom }, i) => {
        const spec = specForTarget(target)
        return spec ? [{ ...spec, ...geom, id: `w${i + 1}` }] : []
    })
    return windowsReducer(EMPTY_WINDOWS, { type: "restore", wins })
}

export function Shell() {
    const phone = useSyncExternalStore(subscribePhoneLayout, phoneLayout, () => false)
    const location = useLocation()
    const navigate = useNavigate()
    const [meetSlot, setMeetSlot] = useState<HTMLDivElement | null>(null)

    // ── desk size (windows and items are placed in it) ──
    // A state ref: the desk mounts again after a phone → desktop switch, and must be observed again.
    const [deskEl, setDeskEl] = useState<HTMLElement | null>(null)
    const [desk, setDesk] = useState<DeskSize>(initialDesk)
    const deskNow = useRef(desk)
    useEffect(() => {
        if (!deskEl || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(() => {
            const next = { w: deskEl.clientWidth, h: deskEl.clientHeight }
            deskNow.current = next
            setDesk(next)
        })
        ro.observe(deskEl)
        return () => ro.disconnect()
    }, [deskEl])

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
    const skipLockWrite = useRef(false)

    const session = useOsSession({
        onSignedIn: (address) => {
            skipLockWrite.current = false
            markLocked(false)
            setExplicitlyLocked(false)
            setLocked(false)
            win.closeKey("welcome")
            setLinkGuest(false)
            showToast(`Connected with Adena · ${shortAddr(address)}`)
        },
    })
    const memberNow = useRef(session.status === "member")
    useLayoutEffect(() => { memberNow.current = session.status === "member" }, [session.status])
    useLayoutEffect(() => {
        setWalletActionGuard(() => memberNow.current)
        return () => setWalletActionGuard(null)
    }, [])
    const [explicitlyLocked, setExplicitlyLocked] = useState(readLocked)
    const [entry] = useState(() => resolveEntry({ skipIntro: readSkipIntro(), resuming: session.status === "resuming", deepLink: fromLink, locked: explicitlyLocked }))
    const [locked, setLocked] = useState(entry === "lock")
    const liveWidget = useLiveWidget()
    // The memba.club boot (A → C) plays over the lock screen on each plain visit.
    const [booting, setBooting] = useState(() => shouldBoot({
        entry,
        reducedMotion: typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    }))
    const endBoot = useCallback(() => setBooting(false), [])
    const [linkGuest, setLinkGuest] = useState(entry === "link")
    const storageOwner = session.status === "resuming" ? null : session.status === "member"
        ? `member:${session.network.chainId}:${session.address}` : `guest:${session.network.chainId}`

    // Windows placed while the guest banner shows start below it (it sits above windows).
    const bannerUp = linkGuest && session.status !== "member"
    // A maximised window must start under the banner too, not just newly-placed ones.
    const frameDesk = useMemo<DeskSize>(() => (bannerUp ? { ...desk, top: BANNER_ROOM } : desk), [desk, bannerUp])
    const bannerNow = useRef(bannerUp)
    useEffect(() => { bannerNow.current = bannerUp }, [bannerUp])
    const placeDesk = useCallback((): DeskSize => ({ ...deskNow.current, top: bannerNow.current ? BANNER_ROOM : 0 }), [])

    const win = useWindows(() => arrivalWindows(arrival, fromLink, { ...deskNow.current, top: entry === "link" ? BANNER_ROOM : 0 }, storageOwner, explicitlyLocked))
    const { dispatch } = win
    const previousStorageOwner = useRef(storageOwner)
    const skipSaveFor = useRef<readonly OsWindow[] | null>(null)
    const skipNextOwnerWrite = useRef<string | null>(null)
    const resetLayoutPending = useRef(false)

    useLayoutEffect(() => {
        const previous = previousStorageOwner.current
        if (previous === storageOwner) return
        previousStorageOwner.current = storageOwner
        if (storageOwner === null) return
        if (!fromLink) {
            // A slow silent reconnect can briefly enter guest mode. Recover the
            // destination's saved desk once its identity is known, including an
            // intentionally empty desk. A first-time member keeps the public
            // windows they just opened as a guest.
            if (previous?.startsWith("guest:") && storageOwner.startsWith("member:")) {
                try {
                    if (localStorage.getItem(windowsStorageKey(storageOwner)) === null) return
                } catch { return }
            }
            skipSaveFor.current = win.wins
            skipNextOwnerWrite.current = storageOwner
            const restored = arrivalWindows(arrival, false, placeDesk(), storageOwner, explicitlyLocked)
            dispatch({ type: "restore", wins: restored.wins })
        } else if (previous?.startsWith("guest:") && storageOwner.startsWith("member:")) {
            // A link remains visible after connection, but is not an edit to
            // the member's previously saved desktop.
            skipNextOwnerWrite.current = storageOwner
        } else if (previous !== null) {
            // On a linked page, a different account or network must not retain
            // the previous owner's paths or overwrite the destination layout.
            skipSaveFor.current = win.wins
            skipNextOwnerWrite.current = storageOwner
            dispatch({ type: "closeAll" })
        }
    }, [storageOwner, fromLink, arrival, explicitlyLocked, dispatch, win.wins, placeDesk])

    useEffect(() => {
        dispatch({ type: "fit", desk: frameDesk })
    }, [dispatch, frameDesk])

    useEffect(() => {
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
        dispatch({ type: "navigate", specs, desk: placeDesk(), exact: navType === "POP" })
    }, [here, location.pathname, location.search, navType, dispatch, placeDesk])
    // Declared after the reader on purpose: effects run in order, and the reader
    // must see the URL before this one replaces it, or it would take the old URL
    // for a back/forward navigation.
    // It writes only when the windows change, and only a URL they haven't written or
    // been read from yet: a page that redirects as it opens (NFT → the marketplace)
    // has already replaced the address, and writing the stale windows' URL over it
    // would leave the window blank.
    const wroteFor = useRef<readonly OsWindow[] | null>(null)
    const wroteOwner = useRef<string | null>(null)
    const initialSaveChecked = useRef(false)
    useEffect(() => {
        // A repeat welcome keeps the arrival URL plain until the user chooses.
        if ((locked && !explicitlyLocked) || storageOwner === null || skipSaveFor.current === win.wins) return
        const skipOwnerWrite = skipNextOwnerWrite.current === storageOwner
        if (skipOwnerWrite) skipNextOwnerWrite.current = null
        let skipStorageWrite = locked || skipLockWrite.current || skipOwnerWrite
        if (resetLayoutPending.current) {
            if (win.wins.every((w) => w.app === "settings")) skipStorageWrite = true
            else resetLayoutPending.current = false
        }
        if (!initialSaveChecked.current) {
            initialSaveChecked.current = true
            try {
                // Opening or reloading another tab is not a layout edit. Keep
                // the newer saved desktop until this tab changes its windows.
                if (storageOwner && localStorage.getItem(windowsStorageKey(storageOwner)) !== null) {
                    skipStorageWrite = true
                }
            } catch { /* saveWindows handles unavailable storage below */ }
        }
        if (wroteFor.current === win.wins && wroteOwner.current === storageOwner) return
        skipSaveFor.current = null
        wroteFor.current = win.wins
        wroteOwner.current = storageOwner
        if (!skipStorageWrite) saveWindows(win.wins, storageOwner)
        const url = urlForWindows(win.wins)
        if (url === lastUrl.current) return
        lastUrl.current = url
        if (url !== window.location.pathname + window.location.search) navigate(url, { replace: true })
    }, [win.wins, navigate, storageOwner, locked, explicitlyLocked])

    // ── actions ──
    const open = useCallback((spec: WindowSpec, center = false) => dispatch({ type: "open", spec, desk: placeDesk(), center }), [dispatch, placeDesk])
    const openApp = useCallback((app: OsAppId) => open(appSpec(app)), [open])
    const move = useCallback((id: string, x: number, y: number) => dispatch({ type: "move", id, x, y, desk: deskNow.current }), [dispatch])
    const resize = useCallback((id: string, width: number, height: number) => dispatch({ type: "resize", id, width, height, desk: deskNow.current }), [dispatch])
    const frame: FrameActions = { focus: win.focus, close: win.close, minimise: win.minimise, toggleMax: win.toggleMax, move, resize,
        retarget: (id, spec) => dispatch({ type: "retarget", id, spec }) }
    const tile = useCallback(() => dispatch({ type: "tile", desk: placeDesk() }), [dispatch, placeDesk])

    const member = session.status === "member"
    const modalBlocked = locked || Boolean(session.stage)
    const signerOwner = member ? `${session.network.chainId}:${session.address}` : "guest"
    const deskOwner = session.status === "resuming" ? undefined : member ? session.address : null
    const deskItems = useDesk(deskOwner, session.network.key)
    const { resetFromStorage: resetDeskFromStorage } = deskItems
    // Reset is dispatched by Settings after the saved UI keys are removed. Keep
    // that window on screen, and leave the cleared layout absent until the user
    // opens another window. The revision notifies other open OS tabs; their
    // storage event runs the same cleanup without broadcasting it again.
    useEffect(() => {
        const applyReset = () => {
            resetLayoutPending.current = true
            resetDeskFromStorage()
            const settings = win.wins.find((w) => w.app === "settings")
            dispatch({ type: "restore", wins: settings ? [{ ...settings, min: false }] : [] })
        }
        const onLocalReset = () => {
            applyReset()
            try {
                localStorage.setItem(LOCAL_UI_RESET_REVISION_KEY, `${Date.now()}:${Math.random()}`)
            } catch { /* local reset still applies if storage refuses the notification */ }
        }
        const onStorage = (event: StorageEvent) => {
            if (event.key === LOCAL_UI_RESET_REVISION_KEY && event.newValue !== null) applyReset()
        }
        window.addEventListener("memba-os-local-ui-reset", onLocalReset)
        window.addEventListener("storage", onStorage)
        return () => {
            window.removeEventListener("memba-os-local-ui-reset", onLocalReset)
            window.removeEventListener("storage", onStorage)
        }
    }, [resetDeskFromStorage, dispatch, win.wins])

    const unlock = () => {
        skipLockWrite.current = false
        skipNextOwnerWrite.current = storageOwner
        markLocked(false); setExplicitlyLocked(false); setLocked(false)
    }
    const lock = () => {
        skipLockWrite.current = true
        if (member) session.disconnect()
        win.closeAll()
        setLinkGuest(false)
        markLocked(true)
        setExplicitlyLocked(true)
        setLocked(true)
    }

    // ── ⌥ shortcuts (D13) ──
    const front = win.front
    const { close: closeWin, next: nextWin } = win
    const [launcher, setLauncher] = useState(false)
    const launcherOpener = useRef<HTMLElement | null>(null)
    const openLauncher = useCallback(() => {
        launcherOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setLauncher(true)
    }, [])
    const closeLauncher = useCallback((restoreFocus: boolean) => {
        setLauncher(false)
        if (!restoreFocus) return
        requestAnimationFrame(() => {
            const opener = launcherOpener.current
            const fallback = document.querySelector<HTMLElement>('button.os-mb[aria-label^="Search"], button.os-ph-search')
            if (opener?.isConnected) opener.focus({ preventScroll: true })
            else fallback?.focus({ preventScroll: true })
            launcherOpener.current = null
        })
    }, [])
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (document.querySelector('[aria-modal="true"]')) return
            // ⌘K / Ctrl+K opens search, from anywhere (D13).
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !locked && !session.stage) {
                e.preventDefault()
                if (launcher) closeLauncher(true)
                else openLauncher()
                return
            }
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
    }, [locked, session.stage, front, closeWin, nextWin, launcher, openLauncher, closeLauncher])

    // ── right-click menus ──
    const [menu, setMenu] = useState<{ x: number; y: number; item: number | null } | null>(null)
    const [startRequest, setStartRequest] = useState(0)
    const closeMenu = useCallback(() => setMenu(null), [])
    const openMenu = (e: ReactMouseEvent, item: number | null) => {
        const r = deskEl?.getBoundingClientRect()
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
    const meetWindow = win.wins.find((w) => w.target?.kind === "app" && w.target.app === "meet" && !!w.target.section)
    const meetRoom = meetWindow?.target?.kind === "app" && meetWindow.target.section ? normaliseRoomId(meetWindow.target.section) : null
    const meetStage = meetWindow && meetRoom ? <MeetStage key="meet-stage" roomId={meetRoom} slot={meetSlot} minimized={meetWindow.min}
        foreground={front?.id === meetWindow.id && !modalBlocked} restore={() => win.focus(meetWindow.id)} /> : null
    const shared = (
        <>
            {booting && (
                <BootScreen onDone={endBoot} lines={bootLines({
                    chainId: session.network.chainId, isTestnet: session.network.isTestnet,
                    wallet: typeof window !== "undefined" && "adena" in window, deskCount: deskItems.items.length, appCount: OS_APPS.length,
                })} />
            )}
            <ConnectModal session={session} />
            {toast && !locked && <div className="os-toast os-glass" role="status">{toast}</div>}
            {locked && !session.stage && (
                <LockScreen
                    resuming={session.status === "resuming"}
                    onConnect={() => { if (session.status === "member") unlock(); else session.openConnect() }}
                    onGuest={() => {
                        if (session.status !== "guest") session.disconnect()
                        if (session.status === "member") win.closeAll()
                        unlock()
                        if (session.status === "guest" && !win.wins.length) open(welcomeSpec(), true)
                    }}
                />
            )}
        </>
    )
    // A phone draws the same windows as full-screen sheets on a home screen (day 6).
    if (phone) {
        return (
            <LiveActivityProvider networkKey={session.network.key} active={!locked && front?.app === "live"}>
            <SignerProvider key={signerOwner} session={session} toast={showToast}>
                <div className="os-workspace" data-locked={locked || undefined} inert={locked} aria-hidden={locked}>
                <MeetStageContext.Provider value={setMeetSlot}>
                <PhoneShell locked={modalBlocked} session={session} front={front} wins={win.wins} items={deskItems.items} open={open} openApp={openApp} openItem={openItem}
                    close={win.close} toast={showToast} openSearch={openLauncher}
                    home={(id) => {
                        // A history entry for the sheet we leave, so Back (a phone habit) reopens it;
                        // minimising all sheets then rewrites this new entry to /os.
                        // Only for a window with an address: Welcome or Not found share /os with Home.
                        const w = win.wins.find((x) => x.id === id)
                        if (w && windowToken(w.target) !== null) navigate(location.pathname + location.search)
                        win.minimiseAll()
                    }} />
                {launcher && <Launcher network={session.network.key} open={(spec) => open(spec, false)} onClose={closeLauncher} />}
                {meetStage}
                </MeetStageContext.Provider>
                </div>
                {shared}
            </SignerProvider>
            </LiveActivityProvider>
        )
    }
    return (
        <LiveActivityProvider networkKey={session.network.key} active={!locked}>
        <SignerProvider key={signerOwner} session={session} toast={showToast}>
            <div className="os-workspace" data-locked={locked || undefined} inert={locked} aria-hidden={locked}>
            <MeetStageContext.Provider value={setMeetSlot}>
            <MenuBar locked={modalBlocked} session={session} wins={win.wins} front={front} openApp={openApp} openSpec={open} focusWin={win.focus} closeWin={win.close}
                closeAll={win.closeAll} minimiseAll={win.minimiseAll} tile={tile} nextWin={win.next} lock={lock} toast={showToast}
                isPinned={deskItems.isPinned} pin={deskItems.pin} startRequest={startRequest} openSearch={openLauncher} />
            <main ref={setDeskEl} className="os-desk" aria-label="Desktop" inert={modalBlocked} aria-hidden={modalBlocked}
                onContextMenu={(e) => { if (e.target === e.currentTarget && !locked) { e.preventDefault(); openMenu(e, null) } }}>
                {!locked && liveWidget && <LiveTicker onOpen={() => openApp("live")} />}
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
                {win.wins.filter((w) => !w.min || w.key.startsWith("game:")).map((w) => (
                    <WindowFrame key={w.id} win={w} active={!modalBlocked && !w.min && w.id === front?.id} parked={w.min} desk={frameDesk} frame={frame} session={session} openApp={openApp} open={open} toast={showToast} />
                ))}
                {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries} onClose={closeMenu} />}
                {launcher && <Launcher network={session.network.key} open={(spec) => open(spec, false)} onClose={closeLauncher} />}
            </main>
            {bannerUp && (
                <div className="os-banner os-glass" role="status" inert={modalBlocked} aria-hidden={modalBlocked}>
                    Browsing as guest
                    <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
                </div>
            )}
            <Dock wins={win.wins} openApp={openApp} restore={win.focus} locked={modalBlocked} />
            {meetStage}
            </MeetStageContext.Provider>
            </div>
            {shared}
        </SignerProvider>
        </LiveActivityProvider>
    )
}
