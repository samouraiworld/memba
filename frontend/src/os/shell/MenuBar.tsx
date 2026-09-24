/**
 * The menu bar (mockup v4 menubar/panelHTML): Memba start menu, space
 * switcher, the front window's app menu, Window menu, network, notifications,
 * account and clock. One panel is open at a time, anchored under its button.
 *
 * @module os/shell/MenuBar
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { OS_APPS, type OsAppId } from "../apps"
import { AppTile } from "./icons"
import { useClock } from "./clock"
import { shortAddr } from "./format"
import { selectableOsNetworks, switchOsNetwork } from "./network"
import type { OsSession } from "./useOsSession"
import { itemForTarget, type DeskItemType } from "./desk"
import { urlForWindow, type OsWindow } from "./windows"
import { useSigner } from "../sign/signerContext"

type PanelId = "start" | "spaces" | "app" | "window" | "net" | "notif" | "acct"

export interface MenuBarProps {
    session: OsSession
    wins: readonly OsWindow[]
    front: OsWindow | null
    openApp: (app: OsAppId) => void
    focusWin: (id: string) => void
    closeWin: (id: string) => void
    closeAll: () => void
    minimiseAll: () => void
    tile: () => void
    nextWin: () => void
    lock: () => void
    toast: (msg: string) => void
    /** Desktop items: is this thing on the desk, and put it there. */
    isPinned: (item: { ty: DeskItemType; ref: string }) => boolean
    pin: (item: { ty: DeskItemType; ref: string }) => void
    /** Bumped to open the start menu from elsewhere (desktop menu "Add an app…"). */
    startRequest: number
}

function Item({ children, onClick, disabled, hint }: { children: ReactNode; onClick?: () => void; disabled?: boolean; hint?: string }) {
    return (
        <button type="button" role="menuitem" className="os-mi" onClick={onClick} disabled={disabled}>
            <span>{children}</span>{hint && <span className="os-mi-hint">{hint}</span>}
        </button>
    )
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

export function MenuBar(p: MenuBarProps) {
    const { session } = p
    const [panel, setPanel] = useState<PanelId | null>(null)
    const [anchor, setAnchor] = useState(10)
    const barRef = useRef<HTMLElement>(null)
    const [time] = useClock()
    const guest = session.status !== "member"
    const net = session.network
    const signer = useSigner()

    // "Add an app…" on the desktop menu opens the start menu (state adjusted
    // while rendering when the request changes, React's pattern for this).
    const [seenStart, setSeenStart] = useState(p.startRequest)
    if (seenStart !== p.startRequest) {
        setSeenStart(p.startRequest)
        setAnchor(10)
        setPanel("start")
    }

    // Close on Escape or on any click outside the bar and its panel.
    useEffect(() => {
        if (!panel) return
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel(null) }
        const onDown = (e: PointerEvent) => { if (!barRef.current?.contains(e.target as Node)) setPanel(null) }
        window.addEventListener("keydown", onKey)
        window.addEventListener("pointerdown", onDown)
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown) }
    }, [panel])

    const toggle = (id: PanelId) => (e: React.MouseEvent<HTMLButtonElement>) => {
        setAnchor(e.currentTarget.offsetLeft)
        setPanel((cur) => (cur === id ? null : id))
    }
    const run = (fn: () => void) => () => { setPanel(null); fn() }
    const mb = (id: PanelId) => ({ "aria-expanded": panel === id, "aria-haspopup": "menu" as const, onClick: toggle(id) })
    const copy = (text: string, label: string) => run(() => { void copyText(text).then((ok) => p.toast(ok ? `Copied ${label}` : "Couldn't copy: your browser blocked the clipboard")) })

    let content: ReactNode = null
    let right = false
    switch (panel) {
        case "start":
            content = (
                <div className="os-panel-start">
                    <div className="os-who">
                        <span className="os-av os-av-lg" data-guest={guest || undefined} aria-hidden="true">{guest ? "G" : session.address.slice(2, 3).toUpperCase()}</span>
                        <div className="os-grow">
                            <b>{guest ? "Guest" : shortAddr(session.address)}</b>
                            <div className="os-sub os-mono">{guest ? "Read-only · this browser" : net.chainId}</div>
                        </div>
                        {guest && <button type="button" className="os-btn" onClick={run(session.openConnect)}>Connect</button>}
                    </div>
                    <div className="os-mhd">All apps · ＋ adds to desktop</div>
                    <div className="os-pins">
                        {OS_APPS.map((a) => {
                            const on = p.isPinned({ ty: "app", ref: a.id })
                            return (
                                <div key={a.id} className="os-pinbox">
                                    <button type="button" role="menuitem" className="os-pin" onClick={run(() => p.openApp(a.id))}>
                                        <AppTile app={a.id} size={38} /><span>{a.name}</span>
                                    </button>
                                    <button type="button" className={`os-pn${on ? " os-done" : ""}`} aria-label={on ? `${a.name} is on the desktop` : `Add ${a.name} to desktop`}
                                        disabled={on} onClick={() => p.pin({ ty: "app", ref: a.id })}>{on ? "✓" : "+"}</button>
                                </div>
                            )
                        })}
                    </div>
                    <div className="os-menu os-menu-top" role="menu" aria-label="Memba">
                        <Item onClick={run(() => p.openApp("settings"))}>Personalise desktop…</Item>
                        <Item onClick={run(() => { window.location.assign(`/${net.key}/feedback`) })}>Send feedback…</Item>
                        <Item onClick={run(() => p.toast("Memba OS · beta preview"))}>About Memba OS</Item>
                        <div className="os-msep" role="separator" />
                        <Item onClick={run(p.lock)}>{guest ? "Lock screen" : "Disconnect & lock"}</Item>
                    </div>
                </div>
            )
            break
        case "spaces":
            content = (
                <div className="os-panel-list">
                    <div className="os-nh"><b>Spaces</b><span className="os-sub">windows stay per space</span></div>
                    <div className="os-nl">
                        <button type="button" className="os-nc os-cur" onClick={run(() => {})}>
                            <span className="os-av" data-guest={guest || undefined} aria-hidden="true">{guest ? "G" : session.address.slice(2, 3).toUpperCase()}</span>
                            <span><b>My space</b><span className="os-sub os-block">{guest ? "Guest · this browser" : "Personal · only you"}</span></span>
                        </button>
                        <p className="os-sub os-pad">Shared DAO spaces arrive with on-chain spaces.</p>
                    </div>
                </div>
            )
            break
        case "app":
            if (p.front) {
                const f = p.front
                const pinnable = itemForTarget(f.target)
                content = (
                    <div className="os-menu" role="menu" aria-label={f.title}>
                        <div className="os-mhd">{f.app ? OS_APPS.find((a) => a.id === f.app)?.name : f.title}</div>
                        {pinnable && (
                            <Item onClick={run(() => { p.pin(pinnable); p.toast("Added to your desktop") })} disabled={p.isPinned(pinnable)}>
                                {f.target?.kind === "proposal" ? "Bookmark to desktop" : "Add to desktop"}
                            </Item>
                        )}
                        <Item onClick={copy(`${window.location.origin}${urlForWindow(f)}`, "the link")}>Copy link to this window</Item>
                        <Item onClick={run(() => p.closeWin(f.id))} hint="⌥W">Close window</Item>
                    </div>
                )
            }
            break
        case "window":
            content = (
                <div className="os-menu" role="menu" aria-label="Window">
                    <Item onClick={run(p.minimiseAll)} disabled={!p.front}>Minimise all</Item>
                    <Item onClick={run(p.tile)} disabled={!p.front}>Tile two front windows</Item>
                    <Item onClick={run(p.closeAll)} disabled={!p.wins.length}>Close all</Item>
                    <div className="os-msep" role="separator" />
                    {p.wins.length
                        ? [...p.wins].sort((a, b) => a.z - b.z).map((w) => (
                            <Item key={w.id} onClick={run(() => p.focusWin(w.id))}>{w.id === p.front?.id ? "• " : ""}{w.title}{w.min ? " (minimised)" : ""}</Item>
                        ))
                        : <div className="os-sub os-pad">No windows open</div>}
                    <Item onClick={run(p.nextWin)} disabled={p.wins.filter((w) => !w.min).length < 2} hint="⌥`">Next window</Item>
                </div>
            )
            break
        case "net":
            content = (
                <div className="os-menu" role="menu" aria-label="Network">
                    <div className="os-mhd">Network</div>
                    {selectableOsNetworks().map((n) => (
                        <button key={n.key} type="button" role="menuitemradio" aria-checked={n.key === net.key} className="os-mi"
                            onClick={run(() => switchOsNetwork(n.key))}>
                            <span>{n.key === net.key ? "✓ " : ""}{n.chainId} · {n.isTestnet ? "Testnet (sandbox funds)" : "Mainnet"}</span>
                        </button>
                    ))}
                    <div className="os-msep" role="separator" />
                    <div className="os-sub os-pad">RPC {net.rpcHost}</div>
                </div>
            )
            break
        case "notif":
            right = true
            content = (
                <div className="os-panel-list">
                    <div className="os-nh"><b>Notifications</b></div>
                    <div className="os-nl">
                        {signer.notices.map((n) => (
                            <div key={n.id} className={`os-nc os-nc-${n.kind}`}>
                                <span className="os-grow"><b>{n.title}</b><span className="os-sub os-block">{n.sub}</span></span>
                            </div>
                        ))}
                        {guest
                            ? <div className="os-gate"><span>Connect for DAO, multisig and prize alerts.</span><button type="button" className="os-btn" onClick={run(session.openConnect)}>Connect</button></div>
                            : signer.notices.length === 0 && <p className="os-sub os-pad">You're all caught up. Votes, signature requests and replies will show here.</p>}
                    </div>
                </div>
            )
            break
        case "acct":
            right = true
            content = (
                <div className="os-menu" role="menu" aria-label="Account">
                    <div className="os-mhd os-mono">{shortAddr(session.address)}</div>
                    <Item onClick={run(() => p.openApp("profile"))}>Profile</Item>
                    <Item onClick={copy(session.address, "your address")}>Copy address</Item>
                    <div className="os-msep" role="separator" />
                    <Item onClick={run(p.lock)}>Disconnect & lock</Item>
                </div>
            )
            break
    }

    return (
        <header className="os-menubar" aria-label="Menu bar" ref={barRef}>
            <button type="button" className="os-mb" aria-label="Memba menu" {...mb("start")}><span className="os-mark" aria-hidden="true" /></button>
            <button type="button" className="os-mb os-strong" {...mb("spaces")}>
                <span className="os-av os-av-sm" data-guest={guest || undefined} aria-hidden="true">{guest ? "G" : session.address.slice(2, 3).toUpperCase()}</span>
                My space <span className="os-caret" aria-hidden="true">▾</span>
            </button>
            {p.front && <button type="button" className="os-mb" {...mb("app")}>{p.front.app ? OS_APPS.find((a) => a.id === p.front?.app)?.name : p.front.title}</button>}
            <button type="button" className="os-mb" {...mb("window")}>Window</button>
            <span className="os-sp" />
            <button type="button" className={`os-mb os-net${net.isTestnet ? " os-test" : ""}`} aria-label={`Network: ${net.chainId}`} {...mb("net")}>
                <i aria-hidden="true" /><span className="os-mono">{net.chainId}</span>{net.isTestnet && <span className="os-testpill">TESTNET</span>}
            </button>
            {signer.pending.length > 0 && (
                <span className="os-mb" role="status" title="Waiting for the chain"><span className="os-spin" aria-hidden="true" />{signer.pending.length} pending</span>
            )}
            <button type="button" className="os-mb" aria-label={signer.unread ? `Notifications, ${signer.unread} new` : "Notifications"} {...mb("notif")}
                onClick={(e) => { toggle("notif")(e); signer.markRead() }}>
                🔔{signer.unread > 0 && <span className="os-badge" aria-hidden="true">{signer.unread}</span>}
            </button>
            {session.status === "member"
                ? <button type="button" className="os-mb os-acct" aria-label={`Account ${session.address}`} {...mb("acct")}>
                    <span className="os-av os-av-xs" aria-hidden="true">{session.address.slice(2, 3).toUpperCase()}</span>
                    <span className="os-mono">{shortAddr(session.address)}</span>
                </button>
                : session.status === "resuming"
                    ? <span className="os-mb" role="status"><span className="os-spin" aria-hidden="true" />Resuming…</span>
                    : <button type="button" className="os-mb os-connect" onClick={session.openConnect}>Connect wallet</button>}
            <span className="os-mono os-clock">{time}</span>
            {content && (
                <div className="os-panel os-glass" data-panel={panel} style={right ? { right: panel === "acct" ? 60 : 10 } : { left: anchor }}>
                    {content}
                </div>
            )}
        </header>
    )
}
