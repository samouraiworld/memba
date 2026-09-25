/**
 * Line icons and app tiles, drawn as in mockup v4 (24-unit stroke paths).
 *
 * @module os/shell/icons
 */
import type { CSSProperties } from "react"
import { getApp, type OsAppId } from "../apps"

const PATHS = {
    dao: <path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5" />,
    wal: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2" /></>,
    feed: <path d="M5 6h14M5 11h14M5 16h9" />,
    msig: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M3 19c1-3 3-4 5-4s4 1 5 4M11 19c1-3 3-4 5-4s4 1 5 4" /></>,
    store: <path d="M4 9h16l-1 10H5zM8 9a4 4 0 018 0" />,
    game: <><rect x="3" y="8" width="18" height="10" rx="5" /><path d="M8 11v4M6 13h4" /><circle cx="16" cy="12" r=".8" /><circle cx="17.6" cy="14.6" r=".8" /></>,
    val: <><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
    set: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
    tok: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
    nft: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.6" /><path d="M4 16l5-5 4 4 3-3 4 4" /></>,
    tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
    quest: <path d="M6 21V4M6 4h11l-2 4 2 4H6" />,
    exp: <><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
    chart: <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />,
    prof: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></>,
    news: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12h8M8 15h5" /></>,
    folder: <path d="M3 7.5A2 2 0 015 5.5h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
    doc: <path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6" />,
    term: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10l3 2-3 2M12 15h5" /></>,
    home: <path d="M4 11l8-7 8 7v9H4z" />,
} as const

export type IconName = keyof typeof PATHS

const APP_ICON: Record<OsAppId, IconName> = {
    daos: "dao", wallet: "wal", multisig: "msig", feed: "feed", store: "store", arcade: "game", validators: "val",
    settings: "set", tokens: "tok", nft: "nft", market: "tag", quests: "quest", explorer: "exp", profile: "prof", news: "news",
    devreport: "chart", terminal: "term",
}

export function Icon({ name }: { name: IconName }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</g>
        </svg>
    )
}

/** A rounded, gradient app tile. `size` is in px (default 48). */
export function AppTile({ app, size }: { app: OsAppId; size?: number }) {
    const a = getApp(app)
    const style = { background: `linear-gradient(135deg,${a.tint[0]},${a.tint[1]})`, ...(size ? { "--os-ts": `${size}px` } : {}) } as CSSProperties
    return <span className="os-tile" style={style}><Icon name={APP_ICON[app]} /></span>
}

/** A tile for things that aren't apps (DAO folder, proposal, multisig). */
export function ThingTile({ icon, tint, size }: { icon: IconName; tint?: readonly [string, string]; size?: number }) {
    const style = {
        ...(tint ? { background: `linear-gradient(135deg,${tint[0]},${tint[1]})` } : {}),
        ...(size ? { "--os-ts": `${size}px` } : {}),
    } as CSSProperties
    return <span className={tint ? "os-tile" : "os-tile os-doc"} style={style}><Icon name={icon} /></span>
}
