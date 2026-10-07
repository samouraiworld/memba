/**
 * Native Validators window: the consensus set of the active chain with each
 * validator's health, and the operators registered on chain that are not in
 * it. A validator's own page, the Network view, Hacker mode and Alerts are
 * still the classic pages, handed through as `fallback` in this same window.
 *
 * The view (which list, the search, the health filter) lives in the window's
 * query string, under the keys the classic validator page sends back through
 * its "← Validators" link (`tab`, `q`, `health`). `tab=network` is the classic
 * page's own Network view.
 *
 * @module os/apps/validators/native
 */
import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { GNO_RPC_URL } from "../../../lib/config"
import { ValidatorHealthStatus, healthLabel, type NetworkHealthSummary } from "../../../lib/validatorHealth"
import { fetchValidatorRoster, ROSTER_REFRESH_MS, type ValidatorRoster } from "../../../lib/validatorRoster"
import { formatBlockTime, formatPercent, formatVotingPower, truncateValidatorAddr, type ValidatorInfo } from "../../../lib/validators"
import { computeValoperStatus, fetchValopers, type ValoperWithStatus } from "../../../lib/valopers"
import { Chips, Empty, ErrorState, Loading, Pill, Segmented, StatGrid, Table, type Column, type PillTone, type Stat } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { classicForSection, classicHome, sectionForClassic } from "../../page/classicRoute"
import { specForTarget } from "../../shell/windows"
import "./validators.css"

const APP = "validators"
const PAGE_SIZE = 25
const REGISTRY_REFRESH_MS = 5 * 60_000
const NETWORK_QUERY = "tab=network"

type List = "active" | "candidates"
type HealthFilter = ValidatorHealthStatus | "all"
interface View { list: List; q: string; health: HealthFilter }

const LISTS: readonly { id: List; name: string }[] = [
    { id: "active", name: "Active set" },
    { id: "candidates", name: "Candidates" },
]
// Worst first: one press on the Health header brings the problems to the top.
const SEVERITY: readonly ValidatorHealthStatus[] = [ValidatorHealthStatus.Down, ValidatorHealthStatus.Degraded, ValidatorHealthStatus.Unknown, ValidatorHealthStatus.Healthy]
const TONE: Record<ValidatorHealthStatus, PillTone> = {
    [ValidatorHealthStatus.Healthy]: "ok",
    [ValidatorHealthStatus.Degraded]: "warn",
    [ValidatorHealthStatus.Down]: "err",
    [ValidatorHealthStatus.Unknown]: "neutral",
}
const HOSTING: Record<string, string> = { "cloud": "Cloud", "on-prem": "On-prem", "data-center": "Data center" }

function readView(query: string | undefined): View {
    const params = new URLSearchParams(query)
    const health = SEVERITY.find((status) => status === params.get("health"))
    return { list: params.get("tab") === "candidates" ? "candidates" : "active", q: params.get("q") ?? "", health: health ?? "all" }
}

function viewQuery(view: View): string {
    const params = new URLSearchParams()
    if (view.list === "candidates") params.set("tab", "candidates")
    if (view.q) params.set("q", view.q)
    if (view.health !== "all") params.set("health", view.health)
    return params.toString()
}

/**
 * Polls only while the window is in front. One behind another still reads once,
 * so it is never left on its loading line, and one brought forward reads again
 * when what it shows has gone stale or its read failed.
 */
const frontOnly = (active: boolean, everyMs: number) => ({
    enabled: (query: { state: { data: unknown; status: string } }) => active || (query.state.data === undefined && query.state.status !== "error"),
    refetchInterval: active && everyMs,
})

const shortAddress = (v: ValidatorInfo) => truncateValidatorAddr(v.gnoAddr || v.address)
const nameOf = (v: ValidatorInfo) => v.moniker || shortAddress(v)
/** Missing figures sort below every real one. */
const byNumber = (pick: (v: ValidatorInfo) => number | null) => (a: ValidatorInfo, b: ValidatorInfo) => (pick(a) ?? -1) - (pick(b) ?? -1)

/** A figure nobody reported: a dash to the eye, words to a screen reader. Never a zero. */
function NoData({ label }: { label: string }) {
    return <><span aria-hidden="true">—</span><span className="os-validators-sr">{label}</span></>
}

function Health({ v }: { v: ValidatorInfo }) {
    const reason = v.healthStatus === ValidatorHealthStatus.Healthy ? undefined : v.healthMeta?.reason
    return <>
        <Pill tone={TONE[v.healthStatus]}>{healthLabel(v.healthStatus)}</Pill>
        {reason && <span className="os-sub os-validators-reason">{reason}</span>}
    </>
}

// validators.css drops columns by position in a narrow window: keep the two in step.
const COLUMNS: readonly Column<ValidatorInfo>[] = [
    { key: "rank", label: "Rank", render: (v) => v.rank, sort: (a, b) => a.rank - b.rank },
    {
        key: "validator", label: "Validator", sort: (a, b) => nameOf(a).localeCompare(nameOf(b)),
        render: (v) => <>
            <span className="os-validators-name">{nameOf(v)}</span>
            {v.moniker && <span className="os-sub os-mono os-validators-sub">{shortAddress(v)}</span>}
        </>,
    },
    { key: "power", label: "Voting power", align: "end", render: (v) => formatVotingPower(v.votingPower), sort: (a, b) => a.votingPower - b.votingPower },
    { key: "share", label: "Share", align: "end", render: (v) => `${v.powerPercent.toFixed(1)}%`, sort: (a, b) => a.powerPercent - b.powerPercent },
    {
        key: "participation", label: "Participation", align: "end", sort: byNumber((v) => v.participationRate),
        render: (v) => v.participationRate == null ? <NoData label="No monitoring data" /> : formatPercent(v.participationRate),
    },
    {
        key: "uptime", label: "Uptime", align: "end", sort: byNumber((v) => v.uptimePercent),
        render: (v) => v.uptimePercent == null ? <NoData label="No monitoring data" /> : formatPercent(v.uptimePercent),
    },
    { key: "health", label: "Health", render: (v) => <Health v={v} />, sort: (a, b) => SEVERITY.indexOf(a.healthStatus) - SEVERITY.indexOf(b.healthStatus) },
]

const CANDIDATE_COLUMNS: readonly Column<ValoperWithStatus>[] = [
    { key: "operator", label: "Operator", render: (o) => <span className="os-validators-name">{o.moniker}</span>, sort: (a, b) => a.moniker.localeCompare(b.moniker) },
    // The registry's own word when it is not one of the three the realm documents (never a prototype key).
    { key: "hosting", label: "Hosting", render: (o) => !o.serverType ? <NoData label="Not stated" /> : Object.hasOwn(HOSTING, o.serverType) ? HOSTING[o.serverType] : o.serverType },
    { key: "address", label: "Operator address", render: (o) => <span className="os-mono os-validators-address">{o.operatorAddress}</span> },
]

function summary(roster: ValidatorRoster): Stat[] {
    const { stats, networkHealth: h } = roster
    return [
        { label: "Block height", value: stats.blockHeight.toLocaleString(), hint: stats.catchingUp ? "The RPC node is still catching up" : "The RPC node reports it is in sync" },
        // 0 means the older block could not be read: no figure rather than a made-up one.
        ...(stats.avgBlockTime > 0 ? [{ label: "Average block time", value: formatBlockTime(stats.avgBlockTime), hint: "Over the last 10 blocks" }] : []),
        { label: "Active validators", value: stats.totalValidators, hint: `${formatVotingPower(stats.totalVotingPower)} total voting power` },
        { label: "Healthy", value: `${h.healthy} of ${h.total}`, hint: `${h.degraded} degraded · ${h.down} down · ${h.unknown} unknown` },
        ...(h.avgUptime != null ? [{ label: "Average uptime", value: formatPercent(h.avgUptime), hint: "Validators with monitoring data" }] : []),
    ]
}

function healthOptions(h: NetworkHealthSummary): { id: HealthFilter; name: string; count: number }[] {
    return [
        { id: "all", name: "All", count: h.total },
        { id: ValidatorHealthStatus.Healthy, name: healthLabel(ValidatorHealthStatus.Healthy), count: h.healthy },
        { id: ValidatorHealthStatus.Degraded, name: healthLabel(ValidatorHealthStatus.Degraded), count: h.degraded },
        { id: ValidatorHealthStatus.Down, name: healthLabel(ValidatorHealthStatus.Down), count: h.down },
        { id: ValidatorHealthStatus.Unknown, name: healthLabel(ValidatorHealthStatus.Unknown), count: h.unknown },
    ]
}

function ActiveSet({ roster, view, chainId, setView, onOpen }: {
    roster: ValidatorRoster
    view: View
    chainId: string
    setView: (patch: Partial<View>) => void
    onOpen: (address: string) => void
}) {
    const search = useRef<HTMLInputElement>(null)
    const { validators } = roster
    if (validators.length === 0) return <Empty title={`The ${chainId} RPC returned an empty validator set.`} />
    const needle = view.q.trim().toLowerCase()
    const rows = validators.filter((v) => (view.health === "all" || v.healthStatus === view.health)
        && (!needle || [v.moniker, v.gnoAddr, v.address].some((text) => text.toLowerCase().includes(needle))))
    const monitored = validators.some((v) => v.participationRate != null || v.uptimePercent != null || v.missedBlocks != null || v.incidents.length > 0)
    // A source that answered for nobody while others did: its column is empty, and the page says why.
    const unread = [
        ...(validators.every((v) => v.participationRate == null) ? ["Participation"] : []),
        ...(validators.every((v) => v.uptimePercent == null) ? ["Uptime"] : []),
    ]
    return <>
        <div className="os-validators-tools">
            <input ref={search} type="search" className="os-in os-validators-search" aria-label="Search validators" placeholder="Name or address" maxLength={100}
                value={view.q} onChange={(event) => setView({ q: event.target.value })} />
            <Chips<HealthFilter> label="Filter by health" options={healthOptions(roster.networkHealth)} value={view.health} onChange={(health) => setView({ health })} />
        </div>
        {!monitored && roster.signaturesRead && <p className="os-note" role="note">No monitoring data could be read. Participation and uptime are unavailable, and health relies on recent block signatures alone.</p>}
        {!monitored && !roster.signaturesRead && <p className="os-note" role="note">Neither monitoring data nor recent block signatures could be read: health is unknown.</p>}
        {monitored && !roster.signaturesRead && <p className="os-note" role="note">Recent block signatures could not be read: health relies on monitoring data alone.</p>}
        {monitored && unread.length > 0 && <p className="os-note" role="note">{unread.join(" and ")} could not be read from the monitoring service.</p>}
        <div className="os-validators-set">
            <Table columns={COLUMNS} rows={rows} rowKey={(v) => v.address} openColumn="validator" pageSize={PAGE_SIZE}
                onRowClick={(v) => onOpen(v.gnoAddr || v.address)} rowLabel={(v) => `Open validator ${nameOf(v)}`}
                empty={<Empty title="No validator matches this search and filter."
                    // The button goes with the empty list: focus moves to the search it cleared.
                    action={<button type="button" className="os-btn os-quiet" onClick={() => { setView({ q: "", health: "all" }); search.current?.focus() }}>Clear filters</button>} />} />
        </div>
        <p className="os-sub os-validators-foot">
            Voting power and block signatures are read from the {chainId} RPC. Participation (this month) and uptime come from the monitoring service.
            Health combines monitoring incidents from the last 24 hours, the most recent block signatures and uptime.
        </p>
    </>
}

function Candidates({ roster, network, active, onOpen }: { roster: ValidatorRoster; network: string; active: boolean; onOpen: (address: string) => void }) {
    // Same key and reader as the classic page: the registry is read at the roster's node and height.
    const registry = useQuery({
        queryKey: ["validators", "valopers", network, roster.snapshot.url],
        queryFn: ({ signal }) => fetchValopers(GNO_RPC_URL, roster.activeSigning, roster.snapshot, signal),
        ...frontOnly(active, REGISTRY_REFRESH_MS),
    })
    if (registry.isPending) return <Loading label="Reading the operator registry…" />
    if (!registry.data) return <ErrorState message="The operator registry could not be read." onRetry={() => void registry.refetch()} />
    // Against the current set, not the one the registry was read with: a candidate may have joined since.
    const rows = registry.data
        .filter((o) => computeValoperStatus(o.signingAddress, roster.activeSigning) === "candidate")
        .sort((a, b) => a.moniker.localeCompare(b.moniker))
    return <>
        {registry.isError && <ErrorState message="The last read of the operator registry failed: this list may be out of date." onRetry={() => void registry.refetch()} />}
        <p className="os-sub os-validators-foot">Operators registered in gno.land/r/gnops/valopers whose signing key is not in the consensus set.</p>
        <div className="os-validators-candidates">
            <Table columns={CANDIDATE_COLUMNS} rows={rows} rowKey={(o) => o.operatorAddress} pageSize={PAGE_SIZE}
                onRowClick={(o) => onOpen(o.operatorAddress)} rowLabel={(o) => `Open operator ${o.moniker}`}
                empty={<Empty title="No registered operator is outside the consensus set." />} />
        </div>
    </>
}

function Home({ query, session, active, open, push }: Pick<NativeViewProps, "query" | "session" | "active" | "open" | "push">) {
    const view = readView(query)
    const roster = useQuery({
        queryKey: ["validators", "roster", session.network.key],
        queryFn: ({ signal }) => fetchValidatorRoster(signal),
        ...frontOnly(active, ROSTER_REFRESH_MS),
    })
    const spec = (section: string | null, nextQuery: string) => specForTarget({ kind: "app", app: APP, section, query: nextQuery })!
    // A list, a search or a filter refines this page: it replaces the address. A classic
    // page is somewhere else: a history entry, so Back returns here.
    const setView = (patch: Partial<View>) => open(spec(null, viewQuery({ ...view, ...patch })))
    const openClassic = (page: string, nextQuery = "") => push(spec(sectionForClassic(APP, page), nextQuery))
    // The validator page returns here through `from`, so its back link restores this view.
    const openProfile = (address: string) => {
        const from = viewQuery(view)
        openClassic(`validators/${address}`, from ? new URLSearchParams({ from }).toString() : "")
    }
    const data = roster.data

    return (
        <div className="os-validators">
            <header className="os-validators-head">
                <div>
                    <h1 tabIndex={-1}>Validators</h1>
                    <p className="os-sub">The consensus set of {session.network.chainId}, and the operators registered on chain that are not in it.</p>
                </div>
                <div className="os-row">
                    <button type="button" className="os-btn os-quiet" onClick={() => push(spec(null, NETWORK_QUERY))}>Network</button>
                    <button type="button" className="os-btn os-quiet" onClick={() => openClassic("validators/hacker")}>Hacker mode</button>
                    <button type="button" className="os-btn os-quiet" onClick={() => open(alerts())}>Alerts</button>
                </div>
            </header>
            {roster.isPending && <Loading label="Reading the validator set…" />}
            {roster.isError && !data && <ErrorState message={`The validator set could not be read from the ${session.network.chainId} RPC.`} onRetry={() => void roster.refetch()} />}
            {data && <>
                {roster.isError && <ErrorState onRetry={() => void roster.refetch()}
                    message={`The last refresh failed. This is the validator set as read at ${new Date(roster.dataUpdatedAt).toLocaleTimeString()}: heights and health are not live.`} />}
                <StatGrid stats={summary(data)} />
                <Segmented<List> label="Validator lists" options={LISTS} value={view.list} onChange={(list) => setView({ list })} />
                {view.list === "active"
                    ? <ActiveSet roster={data} view={view} chainId={session.network.chainId} setView={setView} onOpen={openProfile} />
                    : <Candidates roster={data} network={session.network.key} active={active} onOpen={openProfile} />}
            </>}
        </div>
    )
}

/** Validator alerts live in Settings → Notifications. */
const alerts = () => specForTarget({ kind: "app", app: "settings", section: "notifications" })!

/**
 * An address from before alerts moved (/os/validators/alerts) opens them where
 * they are now. This window goes back to the Validators home first (it may be
 * one the user already had open), so no empty window stays behind.
 */
function AlertsMoved({ open }: Pick<NativeViewProps, "open">) {
    useEffect(() => {
        open(specForTarget({ kind: "app", app: APP, section: null })!)
        open(alerts())
    }, [open])
    return null
}

export default function ValidatorsWindow({ section, query, session, active, open, push, fallback }: NativeViewProps) {
    if (section === "alerts") return <AlertsMoved open={open} />
    const home = classicForSection(APP, section) === classicHome(APP)
    if (!home || new URLSearchParams(query).get("tab") === "network") return <>{fallback}</>
    return <Home query={query} session={session} active={active} open={open} push={push} />
}
