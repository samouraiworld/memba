/**
 * The Memba OS shell: entry logic (D7), menu bar, windows, dock, connect flow.
 * Scenarios from mockup v4: first visit (lock screen), returning member
 * (session resumes, no lock), shared link (opens as guest), new wallet
 * (connect → activation, empty desk).
 *
 * @module os/shell/Shell
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import type { OsAppId } from "../apps"
import { ConnectModal } from "./ConnectModal"
import { Dock } from "./Dock"
import { markSeen, readSeen, resolveEntry } from "./entry"
import { LockScreen } from "./LockScreen"
import { shortAddr } from "./format"
import { MenuBar } from "./MenuBar"
import { takeNetworkSwitchNotice } from "./network"
import { isDeepLink, parseOsPath } from "./osPath"
import { useOsSession } from "./useOsSession"
import { WindowFrame } from "./WindowFrame"
import { appSpec, specForTarget, useWindows, welcomeSpec } from "./windows"

const TOAST_MS = 2600

export function Shell() {
    const { pathname } = useLocation()
    const [target] = useState(() => parseOsPath(pathname))
    const [toast, setToast] = useState<string | null>(null)
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const showToast = useCallback((msg: string) => {
        setToast(msg)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
    }, [])
    useEffect(() => () => clearTimeout(toastTimer.current), [])

    const initialSpec = specForTarget(target)
    const { wins, front, open, focus, close, closeKey, closeAll } = useWindows(initialSpec ? [initialSpec] : [])

    const session = useOsSession({
        onSignedIn: (address) => {
            closeKey("welcome")
            setLinkGuest(false)
            showToast(`Connected with Adena · ${shortAddr(address)}`)
        },
    })

    // Decided once, on arrival.
    const [entry] = useState(() => resolveEntry({ seen: readSeen(), resuming: session.status === "resuming", deepLink: isDeepLink(target) }))
    const [locked, setLocked] = useState(entry === "lock")
    const [linkGuest, setLinkGuest] = useState(entry === "link")

    useEffect(() => {
        if (entry !== "lock") markSeen()
        const switched = takeNetworkSwitchNotice()
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot notice read from sessionStorage after a switch reload
        if (switched) showToast(switched)
    }, [entry, showToast])

    // A resumed session says so once; a failed resume just leaves a guest desktop.
    const wasResuming = useRef(session.status === "resuming")
    useEffect(() => {
        if (!wasResuming.current || session.status === "resuming") return
        wasResuming.current = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to the wallet finishing its silent reconnect
        if (session.status === "member") showToast("Welcome back · session resumed")
    }, [session.status, showToast])

    const openApp = useCallback((app: OsAppId) => open(appSpec(app)), [open])

    const unlock = () => { setLocked(false); markSeen() }
    const lock = () => {
        if (session.status === "member") session.disconnect()
        closeAll()
        setLinkGuest(false)
        setLocked(true)
    }

    const member = session.status === "member"
    return (
        <>
            <MenuBar session={session} wins={wins} front={front} openApp={openApp} focusWin={focus} closeWin={close}
                closeAll={closeAll} lock={lock} toast={showToast} />
            <main className="os-desk" aria-label="Desktop">
                {member && wins.length === 0 && (
                    <div className="os-getstarted os-glass">
                        <div className="os-getstarted-title">Your desk is empty — let's fill it.</div>
                        <div className="os-sub">Anything you join or bookmark appears here as an icon.</div>
                        <div className="os-g2">
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("daos")}>Join a DAO</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("daos")}>Create a DAO</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("multisig")}>Set up a multisig</button>
                            <button type="button" className="os-btn os-ghost" onClick={() => openApp("arcade")}>Play a game</button>
                        </div>
                    </div>
                )}
                {wins.map((w, i) => (
                    <WindowFrame key={w.id} win={w} index={i} active={w.id === front?.id} session={session} openApp={openApp}
                        onFocus={() => { if (w.id !== front?.id) focus(w.id) }} onClose={() => close(w.id)} />
                ))}
            </main>
            {linkGuest && !member && (
                <div className="os-banner os-glass" role="status">
                    Browsing as guest
                    <button type="button" className="os-btn" onClick={session.openConnect}>Connect to vote</button>
                </div>
            )}
            <Dock wins={wins} openApp={openApp} />
            <ConnectModal session={session} />
            {toast && <div className="os-toast os-glass" role="status">{toast}</div>}
            {locked && (
                <LockScreen
                    onConnect={() => { unlock(); session.openConnect() }}
                    onGuest={() => { unlock(); open(welcomeSpec()) }}
                />
            )}
        </>
    )
}
