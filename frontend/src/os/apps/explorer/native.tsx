/**
 * Explorer native home: the chain's current figures and the realm directory
 * (search, list, pager), read with the data functions the classic Directory
 * uses. It takes only the app's home address with none of the classic
 * Directory's own query keys; a realm, every classic tab and the legacy
 * `explorer/*` addresses stay the classic page, handed through as `fallback`.
 * Above a classic view sits a control back to this home, which the classic
 * page has no link to.
 *
 * Public reading only: no wallet, no signing, no backend write. Opening the
 * home counts as a page visit, as the classic Directory does.
 *
 * @module os/apps/explorer/native
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNO_RPC_URL, GRC20_FACTORY_PATH, isRealmValidOn } from "../../../lib/config"
import { revealInvisibleFormatting as visible } from "../../../lib/dao/v2Text"
import { getDirectoryDAOs, type DirectoryRealm } from "../../../lib/directory"
import { discoveryProvenanceLabel, fetchDirectoryDiscovery, type DirectoryDiscovery } from "../../../lib/directoryDiscovery"
import type { DirectoryTab } from "../../../lib/directoryUrl"
import { explorerHref, toExplorerRelPath } from "../../../lib/explorerLink"
import { NAMESPACE_LISTING_LIMIT } from "../../../lib/gnoweb"
import { trackPageVisit } from "../../../lib/quests"
import { getNetworkStats, type NetworkStats } from "../../../lib/validators"
import { Card, CardGrid, Empty, ErrorState, Loading, StatGrid, Table, type Column, type Stat } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { classicForSection, classicHome, osTargetForClassic } from "../../page/classicRoute"
import { Icon, type IconName } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"
import "./native.css"

const HOME = classicHome("explorer")
/** The classic Directory's own query keys: any of them means the window shows one of its views. */
const CLASSIC_KEYS = ["tab", "realm", "q"] as const
const PAGE_SIZE = 20
const CHAIN_POLL_MS = 30_000
const NO_REALMS: DirectoryRealm[] = []

/** The classic tabs this home links to. `tokens` is offered only where the token factory exists. */
const TABS: readonly { tab: DirectoryTab; name: string; sub: string; icon: IconName }[] = [
    { tab: "packages", name: "Packages", sub: "Listed packages and their source", icon: "folder" },
    { tab: "daos", name: "DAOs", sub: "Listed and saved DAOs", icon: "dao" },
    { tab: "tokens", name: "Tokens", sub: "Tokens made with Memba’s token factory", icon: "tok" },
    { tab: "users", name: "Users", sub: "DAO members found on chain", icon: "prof" },
    { tab: "govdao", name: "GovDAO", sub: "Latest chain governance proposals", icon: "val" },
    { tab: "leaderboard", name: "Leaderboard", sub: "Top contributors by gnolove score", icon: "chart" },
]

// Names, paths and descriptions can come from the chain or from saved entries: shown as text,
// with any invisible character spelled out.
const COLUMNS: readonly Column<DirectoryRealm>[] = [
    { key: "realm", label: "Realm", render: (r) => <><span className="os-explorer-name">{visible(r.name)}</span><span className="os-explorer-path">{visible(r.path)}</span></> },
    { key: "about", label: "About", render: (r) => <>{visible(r.description)}<span className="os-sub os-block">{r.category === "unknown" ? "" : `${r.category} · `}{discoveryProvenanceLabel(r)}</span></> },
]

function chainStats(s: NetworkStats): Stat[] {
    return [
        { label: "Block height", value: s.blockHeight.toLocaleString("en-US"), hint: s.catchingUp ? "The answering node is still syncing" : undefined },
        { label: "Validators", value: s.totalValidators },
        // 0 means the node gave no earlier block to measure against: no figure, rather than a dash.
        ...(s.avgBlockTime > 0 ? [{ label: "Average block time", value: `${s.avgBlockTime.toFixed(1)} s`, hint: "Over the last 10 blocks" }] : []),
        { label: "Chain", value: s.chainId },
    ]
}

/** Why the list may be short, from the realm listing's own read (the packages listing is not shown here). */
function listingGap(d: DirectoryDiscovery): { text: string; cut: boolean } | null {
    if (d.realmStatus === "ready") return null
    if (d.realmStatus === "partial") return { cut: true, text: `Showing the first ${NAMESPACE_LISTING_LIMIT.toLocaleString("en-US")} realms of the on-chain namespace listing. The network cuts a listing at that length, so later realms are missing.` }
    return { cut: false, text: "The on-chain namespace listing could not be read from the network. Only curated and saved entries are shown." }
}

export default function ExplorerWindow({ section, query, session, active, open, push, toast, fallback }: NativeViewProps) {
    const net = session.network.key
    const params = new URLSearchParams(query)
    const home = classicForSection("explorer", section) === HOME
    const native = home && !CLASSIC_KEYS.some((key) => params.has(key))
    const find = (params.get("find") ?? "").trim()
    const searchId = useId()

    // The search box follows the address (a reload, Clear, a return from a classic view).
    const [draft, setDraft] = useState(find)
    const [synced, setSynced] = useState(find)
    if (synced !== find) {
        setSynced(find)
        setDraft(find)
    }

    // A control that navigates between this home and a classic view unmounts when it is
    // used, which drops focus on what is around the view (the page body, the window
    // frame): focus follows into the view it opened. Focus on a control is left alone.
    const heading = useRef<HTMLHeadingElement>(null)
    const back = useRef<HTMLButtonElement>(null)
    const was = useRef(native)
    useEffect(() => {
        if (was.current === native) return
        was.current = native
        const landing = native ? heading.current : back.current
        if (landing && document.activeElement?.contains(landing)) landing.focus({ preventScroll: true })
    }, [native])

    // Counts toward the quest for visiting five pages.
    useEffect(() => { if (native) trackPageVisit("directory") }, [native])

    // The figures poll only while the window is in front. One behind another still reads
    // once, so it is never left on its loading line, and one brought forward reads again
    // when what it shows has gone stale or its read failed.
    const chain = useQuery({
        queryKey: ["os", "explorer", "chain", session.network.chainId],
        queryFn: ({ signal }) => getNetworkStats(GNO_RPC_URL, undefined, signal),
        enabled: (q) => native && (active || (q.state.data === undefined && q.state.status !== "error")),
        refetchInterval: active && CHAIN_POLL_MS, retry: false,
    })
    // Read on every render (one small browser-storage entry): the classic DAOs tab can
    // save a DAO while this window shows it, and the home must list it on the way back.
    const daos = getDirectoryDAOs(net)
    const listing = useQuery({
        // The key hooks/useDirectoryDiscovery uses: the classic tabs and this home share one read.
        queryKey: ["directory", "discovery", net, daos.map((dao) => [dao.path, dao.name, dao.isSaved])],
        queryFn: () => fetchDirectoryDiscovery(net, daos),
        enabled: native, staleTime: 300_000, retry: false,
    })

    const realms = listing.data?.realms ?? NO_REALMS
    const needle = find.toLowerCase()
    const matches = needle ? realms.filter((r) => [r.name, r.path, r.description].some((text) => text.toLowerCase().includes(needle))) : realms
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
    const page = Math.min(pages, Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1))
    const shown = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    // Every navigation of this window is the classic address it stands for. A search or a
    // page of results refines this home: it replaces the address. A realm, a classic tab
    // and the way back from them are somewhere else: a history entry, so Back returns.
    const specFor = (href: string) => {
        const target = href ? osTargetForClassic(href, net) : null
        return target && specForTarget(target)
    }
    const go = (href: string): boolean => {
        const spec = specFor(href)
        if (spec) push(spec)
        return !!spec
    }
    const here = (search: URLSearchParams | string) => `/${net}/${HOME}?${search}`
    const show = (text: string, at: number) => {
        const next = new URLSearchParams()
        if (text.trim()) next.set("find", text.trim())
        if (at > 1) next.set("page", String(at))
        const spec = specFor(here(next))
        if (spec) open(spec)
    }
    const openRealm = (path: string) => {
        if (!go(explorerHref(net, path))) toast("Memba cannot open this path in its realm view.")
    }

    if (!home) return <>{fallback}</>
    if (!native) {
        return (
            <>
                <div className="os-row os-tight-row">
                    <button ref={back} type="button" className="os-btn os-quiet" onClick={() => go(here(""))}><span aria-hidden="true">←</span> Realm directory</button>
                </div>
                {fallback}
            </>
        )
    }

    const gap = listing.data ? listingGap(listing.data) : null
    const typedPath = toExplorerRelPath(find)
    const tabs = TABS.filter((t) => t.tab !== "tokens" || isRealmValidOn(net, GRC20_FACTORY_PATH))
    const search = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        show(draft, 1)
    }
    return (
        <div className="os-explorer os-stack">
            <header>
                <h1 ref={heading} tabIndex={-1}>Realm directory</h1>
                <p className="os-sub os-explorer-lede">
                    Curated realms, DAOs saved in this browser and the realms the network lists under the samcrew namespace.
                    This is not a complete index of {session.network.chainId}: to open any other realm, search for its full path.
                </p>
            </header>

            <div className="os-stack os-tight">
                <h2 className="os-h os-flush">Chain figures</h2>
                {chain.data && <StatGrid stats={chainStats(chain.data)} />}
                {chain.isPending && <Loading label="Reading chain figures…" />}
                {chain.isError && (
                    <ErrorState
                        message={chain.data
                            ? `The latest refresh failed. These figures were read at ${new Date(chain.dataUpdatedAt).toISOString().slice(11, 16)} UTC.`
                            : "The chain figures could not be read from the network."}
                        onRetry={() => void chain.refetch()}
                    />
                )}
            </div>

            <div className="os-stack os-tight">
                <h2 className="os-h os-flush">Listed realms</h2>
                <form className="os-explorer-search" role="search" onSubmit={search}>
                    <label htmlFor={searchId}>Search listed realms, or enter a realm or package path</label>
                    <div>
                        <input id={searchId} className="os-in" type="search" maxLength={200} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Name, or gno.land/r/…" />
                        <button type="submit" className="os-btn">Search</button>
                        {find && <button type="button" className="os-btn os-quiet" onClick={() => show("", 1)}>Clear</button>}
                    </div>
                </form>
                {typedPath && (
                    <div className="os-row">
                        <button type="button" className="os-btn os-ghost os-explorer-open" onClick={() => openRealm(find)}>Open gno.land/{typedPath}</button>
                        <span className="os-sub">A path opens whether or not it is listed here.</span>
                    </div>
                )}
                {listing.isPending && <Loading label="Reading the realm listing…" />}
                {listing.isError && <ErrorState message="The realm directory could not be read." onRetry={() => void listing.refetch()} />}
                {gap && (gap.cut
                    ? <p className="os-note os-warn" role="note">{gap.text}</p>
                    : <ErrorState message={gap.text} onRetry={() => void listing.refetch()} />)}
                {listing.data && (
                    <>
                        <p className="os-sub os-flush">
                            {find
                                ? `${matches.length} of ${realms.length} listed realms match “${find}”`
                                : `${realms.length} ${realms.length === 1 ? "realm" : "realms"} listed`}
                        </p>
                        <Table
                            columns={COLUMNS}
                            rows={shown}
                            rowKey={(r) => r.path}
                            onRowClick={(r) => openRealm(r.path)}
                            rowLabel={(r) => `Open ${visible(r.name)}, ${visible(r.path)}`}
                            empty={<Empty title={find ? `No listed realm matches “${find}”.` : "No realm is listed for this network."} />}
                        />
                        {matches.length > PAGE_SIZE && (
                            <div className="os-explorer-pager">
                                <span className="os-sub">Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + shown.length} of {matches.length}</span>
                                <button type="button" className="os-btn os-quiet" disabled={page <= 1} onClick={() => show(find, page - 1)}>Previous</button>
                                <button type="button" className="os-btn os-quiet" disabled={page >= pages} onClick={() => show(find, page + 1)}>Next</button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="os-stack os-tight">
                <h2 className="os-h os-flush">More in the directory</h2>
                <CardGrid min={140}>
                    {tabs.map((t) => (
                        <Card key={t.tab} onClick={() => go(here(`tab=${t.tab}`))}>
                            <Icon name={t.icon} />
                            <span className="os-grow os-explorer-tab"><b>{t.name}</b><span className="os-sub os-block">{t.sub}</span></span>
                        </Card>
                    ))}
                </CardGrid>
            </div>
        </div>
    )
}
