/** Native Memba OS discovery. The registry and editorial directory remain distinct sources. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { API_BASE_URL, appStorePathFor, isAppReviewsAvailable, isAppStoreEnabled, isRealmValidOn } from "../../../lib/config"
import type { ReviewAct } from "../../../components/reviews/ReviewCard"
import { ReviewsSection } from "../../../components/reviews/ReviewsSection"
import { useReviewsModerator } from "../../../components/reviews/useReviewsModerator"
import { MIN_RATED_COUNT } from "../../../components/reviews/AppReviewStars"
import { buildCatalogue, catalogueCategory, CATALOGUE_CATEGORIES, checkedLinkDate, filterCatalogue, parseCatalogueFilters, updateCatalogueFilters, type CatalogueEntry, type CatalogueFilters } from "../../../lib/appCatalogue"
import { fetchAppStrict, fetchLiveCatalogue, isAppStoreV3On, isSafeRealmPath } from "../../../lib/appStore"
import { ECOSYSTEM_PROJECTS } from "../../../lib/ecosystemDirectory"
import { isValidCid } from "../../../lib/ipfs"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { publisherNote } from "../../../lib/reviews"
import { AppShell, ErrorState, Loading, Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { osTargetForClassic } from "../../page/classicRoute"
import { Icon } from "../../shell/icons"
import { specForTarget } from "../../shell/windows"
import { useSigner } from "../../sign/signerContext"
import { NativeReviewComposer } from "./NativeReviewComposer"
import { reviewActionRequest } from "./reviewActionRequest"
import { CuratorQueue } from "./CuratorQueue"
import { ReportListing } from "./ReportListing"
import "./native.css"

const sections = [
    { id: "discover", name: "Discover", icon: "store" },
    { id: "ecosystem", name: "Ecosystem", icon: "exp" },
    { id: "extensions", name: "Extensions", icon: "set" },
] as const

function monogram(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)).toUpperCase()
}

function Artwork({ entry, large = false }: { entry: CatalogueEntry; large?: boolean }) {
    const [failed, setFailed] = useState(false)
    const cid = entry.listing?.iconCID
    const style = { "--store-hue": `${[...entry.id].reduce((n, char) => (n * 33 + char.charCodeAt(0)) % 360, 0)}deg` } as CSSProperties
    return <span className={`os-store-art${large ? " os-store-art--large" : ""}`} style={style} aria-hidden="true">
        {cid && isValidCid(cid) && !failed
            ? <img src={`${API_BASE_URL}/api/nft/image?cid=${encodeURIComponent(cid)}`} alt="" loading="lazy" onError={() => setFailed(true)} />
            : monogram(entry.name)}
    </span>
}

// Registering a listing is open to anyone: only a live one has been approved.
const LISTING_PROVENANCE: Record<string, string> = {
    live: "Curator approved listing",
    pending: "Pending review, not yet vetted by a curator",
    rejected: "Rejected by a curator",
    delisted: "Delisted",
}

function provenance(entry: CatalogueEntry): string {
    const status = entry.listing?.status ?? ""
    if (entry.source === "registry") return Object.hasOwn(LISTING_PROVENANCE, status) ? LISTING_PROVENANCE[status] : "Unapproved listing"
    if (entry.project?.kind === "tool") return "Independent tool"
    if (entry.realmPath) return "Mainnet realm linked"
    return "External project"
}

function availability(entry: CatalogueEntry): string {
    return entry.availability === "mainnet" ? "Mainnet" : entry.availability === "testnet" ? "Testnet" : entry.availability === "tools" ? "External tool" : "Network not verified"
}

function appSection(entry: CatalogueEntry): string {
    return entry.source === "registry" ? `apps/${entry.realmPath!.replace(/^gno\.land\//, "")}` : `project/${entry.project!.id}`
}

function StoreCard({ entry, onOpen }: { entry: CatalogueEntry; onOpen: () => void }) {
    return <button type="button" className="os-store-card" onClick={onOpen} aria-label={`Details for ${entry.name}`}>
        <Artwork entry={entry} />
        <span className="os-store-card-copy">
            <b>{entry.name}</b>
            <span>{entry.tagline}</span>
            <small>{provenance(entry)} <span aria-hidden="true">·</span> {availability(entry)}</small>
        </span>
        <span className="os-store-card-arrow" aria-hidden="true">↗</span>
    </button>
}

function Screenshot({ cid, name, index }: { cid: string; name: string; index: number }) {
    const [failed, setFailed] = useState(false)
    if (failed) return <span className="os-store-shot-unavailable" role="img" aria-label={`${name} screenshot ${index + 1} unavailable`}>Screenshot unavailable</span>
    return <img src={`${API_BASE_URL}/api/nft/image?cid=${encodeURIComponent(cid)}`} alt={`${name} screenshot ${index + 1}`} loading="lazy" onError={() => setFailed(true)} />
}

function OpenDestination({ entry, session, open }: Pick<NativeViewProps, "session" | "open"> & { entry: CatalogueEntry }) {
    if (entry.url.startsWith("/") && !entry.url.startsWith("//")) {
        const path = `/${session.network.key}${entry.url}`
        const target = osTargetForClassic(path, session.network.key)
        const spec = target && specForTarget(target)
        return spec
            ? <button type="button" className="os-btn" onClick={() => open(spec)}>Open in Memba OS</button>
            : <a className="os-btn" href={path}>Open app</a>
    }
    if (/^https?:\/\//.test(entry.url)) return <a className="os-btn" href={entry.url} target="_blank" rel="noopener noreferrer">Open external site ↗</a>
    return <Pill tone="neutral">No launch link</Pill>
}

function Detail({ section, session, open, close }: NativeViewProps) {
    const signer = useSigner()
    const [reviewRefresh, setReviewRefresh] = useState(0)
    // False once this window is gone, and the list a fee quote was asked from: a quote that returns late opens no sheet.
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const listShown = useRef(reviewRefresh)
    useEffect(() => { listShown.current = reviewRefresh }, [reviewRefresh])
    const moderator = useReviewsModerator(isAppReviewsAvailable())
    const path = section?.startsWith("apps/") ? `gno.land/${section.slice(5)}` : null
    const projectId = section?.startsWith("project/") ? section.slice(8) : null
    const project = ECOSYSTEM_PROJECTS.find((candidate) => candidate.id === projectId)
    const registryEnabled = isAppStoreEnabled() && isRealmValidOn(session.network.key, appStorePathFor(session.network.key))
    const canReadListing = !!path && isSafeRealmPath(path) && registryEnabled
    const detail = useQuery({
        queryKey: ["appStore", "native-detail", session.network.chainId, path],
        queryFn: () => fetchAppStrict(path!), enabled: canReadListing,
        staleTime: 60_000, retry: 1,
    })
    const listing = detail.data
    const entry = project ? buildCatalogue([], [project], session.network.key)[0] : listing ? buildCatalogue([listing], ECOSYSTEM_PROJECTS, session.network.key).find((candidate) => candidate.listing === listing) ?? {
        id: `registry:${listing.pkgPath}`, source: "registry" as const, name: listing.name,
        tagline: listing.tagline, category: catalogueCategory(listing.category), url: listing.appURL,
        realmPath: listing.pkgPath, availability: session.network.key === "mainnet" ? "mainnet" as const : "testnet" as const, listing,
    } : null
    const back = () => { open(specForTarget({ kind: "app", app: "store", section: null })!); close() }
    // An action on a review opens the signing sheet and hands over: the list reloads when the chain has it.
    const act: ReviewAct = async (action) => {
        if (session.status !== "member") { session.openConnect(); return false }
        const from = listShown.current
        // Read from the chain at this click: a cached or fallback price would be refused at the recheck.
        const price = await networkGasPriceFresh().catch(() => { throw new Error("The network fee could not be read. Try again in a moment.") })
        if (!alive.current || listShown.current !== from || !entry) return false
        signer.sign(reviewActionRequest({
            action, appName: entry.name, caller: session.address, networkKey: session.network.key, chainId: session.network.chainId, price,
            onSettled: (outcome) => { if (outcome === "confirmed" || outcome === "submitted") setReviewRefresh((value) => value + 1) },
        }))
        return false
    }
    return <div className="os-store-detail">
        <button type="button" className="os-store-back" onClick={back}>← Discover</button>
        {path && !registryEnabled && <div className="os-note" role="status">Onchain listings are unavailable in this build.</div>}
        {detail.isPending && canReadListing && <Loading label="Loading app details…" />}
        {detail.isError && <ErrorState message="App details could not be read from the registry." onRetry={() => void detail.refetch()} />}
        {!entry && (projectId !== null || (!!path && !isSafeRealmPath(path)) || (canReadListing && !detail.isPending && !detail.isError)) && <div className="os-note" role="status">This app was not found in the current catalogue.</div>}
        {entry && <>
            <header className="os-store-detail-head">
                <Artwork key={entry.id} entry={entry} large />
                <div><p className="os-store-kicker">{entry.category} <span aria-hidden="true">·</span> {availability(entry)}</p><h1>{entry.name}</h1><p>{entry.tagline}</p></div>
            </header>
            {listing?.status !== undefined && listing.status !== "live" && <p className="os-store-notice" role="status">{listing.status ? `This listing is ${listing.status}.` : "This listing has no status."} It is not in the approved catalogue.</p>}
            <div className="os-store-actions">{(!listing || listing.status === "live") && <OpenDestination entry={entry} session={session} open={open} />}{entry.realmPath && <a className="os-btn os-quiet" href={`https://gno.land/${entry.realmPath.replace(/^gno\.land\//, "")}$source`} target="_blank" rel="noopener noreferrer">Read realm source ↗</a>}</div>
            <div className="os-store-detail-columns">
                <div className="os-store-main">
                    <section><h2>About this app</h2><p>{listing?.descr || entry.project?.description || entry.tagline || "The publisher has not supplied a description yet."}</p></section>
                    {!!listing?.screenshotCIDs?.filter(isValidCid).length && <section><h2>Screenshots</h2><div className="os-store-shots">{listing.screenshotCIDs.filter(isValidCid).map((cid, i) => <Screenshot key={cid} cid={cid} name={entry.name} index={i} />)}</div></section>}
                    {entry.source === "registry" && (isAppReviewsAvailable()
                        ? <div className="os-store-reviews">
                            {listing?.status === "live" && <NativeReviewComposer key={entry.realmPath} session={session} subject={entry.realmPath!} appName={entry.name} onSubmitted={() => setReviewRefresh(value => value + 1)} />}
                            <ReviewsSection key={`${entry.realmPath}:${reviewRefresh}`} subject={entry.realmPath!} minRatedCount={MIN_RATED_COUNT} paginate useOnchainSummary os={{ viewer: session.status === "member" ? session.address : null, act }} />
                            <div className="os-store-review-actions"><button type="button" className="os-btn os-quiet" onClick={() => { setReviewRefresh(value => value + 1); void detail.refetch() }}>Refresh reviews</button></div>
                        </div>
                        : <section><h2>Community reviews</h2><p>Onchain app reviews are not available here yet.</p></section>)}
                </div>
                <aside className="os-store-trust"><h2>Before you open</h2><p><b>{provenance(entry)}</b> identifies how this page was listed. Curation is not a code audit or a transaction guarantee.</p>{entry.realmPath && <code>{entry.realmPath}</code>}{listing?.publisher && <p>Listed by <code>{listing.publisher}</code>{publisherNote(listing.publisher, moderator)}</p>}{checkedLinkDate(entry) && <p>Link checked {checkedLinkDate(entry)}</p>}{listing && (listing.status === "live" || listing.status === "pending") && isAppStoreV3On(session.network.key) && <ReportListing session={session} listing={listing} appName={entry.name} onReported={() => void detail.refetch()} />}{entry.source === "editorial" && <p>Independent projects open outside Memba. Check their network before connecting a wallet.</p>}</aside>
            </div>
        </>}
    </div>
}

function Discovery({ props, section }: { props: NativeViewProps; section: "discover" | "ecosystem" }) {
    const { session, query, open } = props
    const registryEnabled = isAppStoreEnabled() && isRealmValidOn(session.network.key, appStorePathFor(session.network.key))
    const live = useQuery({
        queryKey: ["appStore", "native-catalogue", session.network.chainId, appStorePathFor(session.network.key)],
        queryFn: () => fetchLiveCatalogue(), enabled: registryEnabled,
        staleTime: 60_000, retry: 1,
    })
    const filters = parseCatalogueFilters(new URLSearchParams(query))
    const [draft, setDraft] = useState(filters.q)
    const all = useMemo(() => buildCatalogue(registryEnabled ? live.data?.apps ?? [] : [], ECOSYSTEM_PROJECTS, session.network.key), [registryEnabled, live.data, session.network.key])
    const spotlight = all.find((entry) => entry.project?.id === "gnoswap")
    const pool = section === "ecosystem" ? all.filter((entry) => entry.source === "editorial") : all
    const visible = filterCatalogue(pool, filters)
    const navigate = (patch: Partial<CatalogueFilters>) => {
        const next = updateCatalogueFilters(new URLSearchParams(query), patch)
        open(specForTarget({ kind: "app", app: "store", section: section === "discover" ? null : section, query: next.toString() })!)
    }
    const search = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); navigate({ q: draft }) }
    const openEntry = (entry: CatalogueEntry) => open(specForTarget({ kind: "app", app: "store", section: appSection(entry) })!)
    return <div className="os-store-home">
        {section === "discover" && <header className="os-store-hero">
            <div><p className="os-store-kicker">THE GNO ECOSYSTEM, IN ONE PLACE</p><h1>Find your next thing.</h1><p>Apps, games and tools for Gno, with public realms you can inspect and independent projects clearly marked.</p></div>
            {spotlight && <button type="button" className="os-store-spotlight" onClick={() => openEntry(spotlight)} aria-label={`Explore ${spotlight.name}`}>
                <span className="os-store-spotlight-label">A PLACE TO START <span aria-hidden="true">↗</span></span>
                <Artwork entry={spotlight} />
                <strong>{spotlight.name}</strong>
                <small>{provenance(spotlight)} · {availability(spotlight)}</small>
            </button>}
        </header>}
        {section === "ecosystem" && <header className="os-store-section-head"><p className="os-store-kicker">BEYOND THE REGISTRY</p><h1>Ecosystem</h1><p>Independent projects and tools. Their links and network status are shown before you open them.</p></header>}
        <form className="os-store-search" role="search" onSubmit={search}><label htmlFor="os-store-query">Search apps and tools</label><div><input id="os-store-query" type="search" maxLength={200} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="App, category or realm path" /><button type="submit" className="os-btn">Search</button></div></form>
        <div className="os-store-filters"><label>Category<select value={filters.category} onChange={(event) => navigate({ category: event.target.value as CatalogueFilters["category"] })}><option value="all">All categories</option>{CATALOGUE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label>Availability<select value={filters.availability} onChange={(event) => navigate({ availability: event.target.value as CatalogueFilters["availability"] })}><option value="all">Any network</option><option value="mainnet">Mainnet</option><option value="testnet">Testnet</option><option value="tools">Tools</option><option value="unknown">Not verified</option></select></label>{(filters.q || filters.category !== "all" || filters.availability !== "all") && <button type="button" className="os-btn os-quiet" onClick={() => { setDraft(""); navigate({ q: "", category: "all", availability: "all" }) }}>Clear</button>}</div>
        {registryEnabled && live.isPending && <Loading label="Reading onchain listings…" />}
        {registryEnabled && live.isError && <ErrorState message="Onchain listings could not be read. Independent projects remain available below." onRetry={() => void live.refetch()} />}
        {registryEnabled && live.data && !live.data.complete && <p className="os-store-notice" role="status">Showing the first {live.data.apps.length} onchain listings. Search may not cover later pages.</p>}
        {!registryEnabled && <p className="os-store-inline-status" role="status">Onchain registry unavailable · showing independent projects</p>}
        <div className="os-store-list-head"><h2>{filters.q ? "Search results" : section === "ecosystem" ? "Independent projects" : "Explore apps"}</h2>{!(registryEnabled && live.isPending) && <span role="status">{visible.length} {visible.length === 1 ? "result" : "results"}</span>}</div>
        {visible.length === 0
            ? registryEnabled && live.isPending
                ? null
                : <p className="os-store-empty">{registryEnabled && live.isError ? "No independent projects match these filters. Onchain results are unavailable; retry the registry above." : "No projects match these filters. Try another search or clear them."}</p>
            : <div className="os-store-grid">{visible.map((entry) => <StoreCard key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />)}</div>}
        <p className="os-store-footnote">A curator approved listing is a catalogue decision, not a code audit. External projects choose their own wallet and network requirements.</p>
    </div>
}

function Extensions() {
    return <div className="os-store-home"><header className="os-store-section-head"><p className="os-store-kicker">WORK BETTER TOGETHER</p><h1>Extensions</h1><p>Tools that connect to Memba's governance workspace.</p></header><div className="os-store-grid"><div className="os-store-extension"><Icon name="exp" /><h2>Proposal Explorer</h2><p>Search and filter DAO proposals from a DAO window.</p><Pill tone="ok">Available</Pill></div><div className="os-store-extension"><Icon name="chart" /><h2>GnoSwap for DAOs</h2><p>Treasury swap proposals are planned for a later release.</p><Pill tone="neutral">Planned</Pill></div></div></div>
}

export default function StoreWindow(props: NativeViewProps) {
    const { section, session, open, fallback } = props
    if (section?.startsWith("apps/") || section?.startsWith("project/")) return <Detail {...props} />
    if (section === "submit" || section === "my-submissions") return <>{fallback}</>
    if (section !== null && section !== "ecosystem" && section !== "extensions" && section !== "review") return <>{fallback}</>
    const current = section ?? "discover"
    const nav = [
        ...sections,
        ...isAppStoreV3On(session.network.key) ? [{ id: "review", name: "Curator queue", icon: "doc" as const }] : [],
        ...session.status === "member" ? [{ id: "my-submissions", name: "Your listings", icon: "prof" as const }] : [],
    ]
    return <AppShell label="App Store" sections={nav} current={current} onSelect={(next) => open(specForTarget({ kind: "app", app: "store", section: next === "discover" ? null : next })!)}>
        {current === "extensions" ? <Extensions /> : current === "review" ? <CuratorQueue session={session} open={open} /> : <Discovery key={`${current}:${props.query}`} props={props} section={current === "ecosystem" ? "ecosystem" : "discover"} />}
    </AppShell>
}
