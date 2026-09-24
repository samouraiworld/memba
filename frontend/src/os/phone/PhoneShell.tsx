/**
 * Memba OS on a phone (mockup v4 paintPhone): a status bar, a home screen
 * (space chip, a widget, your desk items, All apps), a dock, and one
 * full-screen sheet at a time. The window model is unchanged: a sheet is the
 * front window, Home minimises it (so the address goes back to /os), and
 * links, back/forward and ?w= work as on the desktop.
 *
 * @module os/phone/PhoneShell
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { OS_APPS, type OsAppId } from "../apps"
import type { DeskItem } from "../shell/desk"
import { DeskIcon } from "../shell/DeskItems"
import { AppTile } from "../shell/icons"
import { useClock } from "../shell/clock"
import type { OsSession } from "../shell/useOsSession"
import { WindowBody } from "../shell/WindowFrame"
import { sendSpec, type OsWindow, type WindowSpec } from "../shell/windows"
import { useSigner } from "../sign/signerContext"
import { formatUgnot } from "../wallet/send"

const PHONE_DOCK: readonly OsAppId[] = ["daos", "wallet", "feed"]

export interface PhoneShellProps {
    session: OsSession
    front: OsWindow | null
    items: readonly DeskItem[]
    open: (spec: WindowSpec) => void
    openApp: (app: OsAppId) => void
    openItem: (index: number) => void
    close: (id: string) => void
    /** Leave the front sheet for the home screen (Back reopens it). */
    home: (id: string) => void
    toast: (msg: string) => void
    openSearch: () => void
}

type SystemSheet = "apps" | "notif" | null

export function PhoneShell(p: PhoneShellProps) {
    const { session, front } = p
    const signer = useSigner()
    const [time] = useClock()
    const [sheet, setSheet] = useState<SystemSheet>(null)
    const member = session.status === "member"
    const net = session.network

    // Opening anything from a system sheet shows that window's sheet instead.
    const go = (fn: () => void) => () => { setSheet(null); fn() }

    let content
    if (sheet === "apps") {
        content = (
            <Sheet title="All apps" onHome={() => setSheet(null)}>
                <div className="os-ph-grid">
                    {OS_APPS.map((a) => (
                        <button key={a.id} type="button" className="os-ph-ic" onClick={go(() => p.openApp(a.id))}><AppTile app={a.id} size={52} /><span className="os-ph-label">{a.name}</span></button>
                    ))}
                </div>
            </Sheet>
        )
    } else if (sheet === "notif") {
        content = (
            <Sheet title="Notifications" onHome={() => setSheet(null)}>
                <div className="os-stack os-tight">
                    {signer.notices.map((n) => (
                        <div key={n.id} className={`os-nc os-nc-${n.kind}`}><span className="os-grow"><b>{n.title}</b><span className="os-sub os-block">{n.sub}</span></span></div>
                    ))}
                    {!member
                        ? <div className="os-gate"><span>Connect for DAO, multisig and prize alerts.</span><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></div>
                        : signer.notices.length === 0 && <p className="os-sub">You're all caught up.</p>}
                </div>
            </Sheet>
        )
    } else if (front) {
        content = (
            <Sheet title={front.title} onHome={() => p.home(front.id)} guest={!member} onConnect={session.openConnect}>
                <div className="os-wbody os-ph-body">
                    <WindowBody win={front} session={session} open={p.open} openApp={p.openApp} close={() => p.close(front.id)} toast={p.toast} />
                </div>
            </Sheet>
        )
    } else {
        content = (
            <main className="os-ph-home" aria-label="Home">
                <div className="os-ph-chip os-glass"><span className="os-av os-av-sm" data-guest={member ? undefined : true} aria-hidden="true">{member ? session.address.slice(2, 3).toUpperCase() : "G"}</span><b>My space</b><span className="os-sub">{net.chainId}</span></div>
                <div className="os-ph-widget os-glass">
                    {member ? (
                        <>
                            <span className="os-sub">Balance · {net.chainId}</span>
                            <b className="os-big">{session.layout.rawUgnot === undefined ? session.layout.balance : formatUgnot(session.layout.rawUgnot)}</b>
                            <button type="button" className="os-btn" onClick={() => p.open(sendSpec())}>Send</button>
                        </>
                    ) : (
                        <>
                            <b>Browsing as guest</b>
                            <span className="os-sub">Connect Adena to vote, sign and keep your desk.</span>
                            <button type="button" className="os-btn" onClick={session.openConnect}>Connect wallet</button>
                        </>
                    )}
                </div>
                <div className="os-ph-grid">
                    {p.items.map((it, i) => (
                        <button key={`${it.ty}:${it.ref}`} type="button" className="os-ph-ic" onClick={() => p.openItem(i)}><DeskIcon item={it} /></button>
                    ))}
                    <button type="button" className="os-ph-ic" onClick={() => setSheet("apps")}><span className="os-ph-all" aria-hidden="true">⋯</span><span className="os-ph-label">All apps</span></button>
                </div>
            </main>
        )
    }

    return (
        <div className="os-phone">
            <header className="os-ph-status" aria-label="Status bar">
                <span className="os-mono">{time}</span>
                <span className="os-grow" />
                {signer.pending.length > 0 && <span className="os-spin" role="status" aria-label={`${signer.pending.length} pending`} />}
                <span className="os-row os-tight"><span className={`os-ph-dot${net.isTestnet ? " os-ph-dot-test" : ""}`} aria-hidden="true" />{net.isTestnet && <span className="os-pill">TEST</span>}</span>
                <button type="button" className="os-ph-bell" aria-label={signer.unread ? `Notifications, ${signer.unread} new` : "Notifications"}
                    onClick={() => { signer.markRead(); setSheet("notif") }}>🔔{signer.unread > 0 && <span className="os-ph-badge">{signer.unread}</span>}</button>
            </header>
            {content}
            <nav className="os-ph-dock os-glass" aria-label="Dock">
                {PHONE_DOCK.map((id) => (
                    <button key={id} type="button" aria-label={OS_APPS.find((a) => a.id === id)!.name} onClick={go(() => p.openApp(id))}><AppTile app={id} size={40} /></button>
                ))}
                <button type="button" aria-label="Search" className="os-ph-search" onClick={go(p.openSearch)}>⌕</button>
            </nav>
        </div>
    )
}

function Sheet({ title, onHome, guest, onConnect, children }: { title: string; onHome: () => void; guest?: boolean; onConnect?: () => void; children: ReactNode }) {
    // A new sheet takes focus at its title, so screen readers and keyboards start there.
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
        const cur = document.activeElement
        if (cur?.closest('[aria-modal="true"]')) return
        heading.current?.focus({ preventScroll: true })
    }, [title])
    return (
        <section className="os-ph-sheet" role="region" aria-label={title}>
            <div className="os-ph-sheet-h">
                <button type="button" className="os-btn os-quiet" onClick={onHome}>‹ Home</button>
                <span className="os-grow" />
                {guest && onConnect && <button type="button" className="os-btn" onClick={onConnect}>Connect</button>}
            </div>
            <h2 className="os-ph-title" ref={heading} tabIndex={-1}>{title}</h2>
            <div className="os-ph-sheet-b">{children}</div>
        </section>
    )
}
