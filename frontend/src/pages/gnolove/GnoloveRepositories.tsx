import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useGnoloveRepositories } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { useMinuteClock } from "../../hooks/useMinuteClock"
import { useTabListKeyboard } from "../../hooks/useTabListKeyboard"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { TIME_FILTER_KEYS, TIME_FILTER_LABELS, TimeFilter } from "../../lib/gnoloveConstants"
import { getRepositoryStats } from "../../lib/gnoloveRepositoryStats"
import { formatRelativeTime } from "../../lib/gnoloveTime"
import type { TRepository } from "../../lib/gnoloveSchemas"

const STATUS_LABELS: Record<string, string> = { active: "Active", inactive: "Inactive", archived: "Archived", unavailable: "Unavailable" }

export default function GnoloveRepositories() {
    const nowMs = useMinuteClock()
    const np = useNetworkPath()
    const catalogue = useGnoloveRepositories()
    const [search, setSearch] = useState("")
    const [period, setPeriod] = useState<TimeFilter>(TimeFilter.MONTHLY)
    const activity = useQuery({
        queryKey: ["gnolove", "repository-stats", period],
        queryFn: ({ signal }) => getRepositoryStats(period, signal),
        enabled: !!catalogue.data?.length,
        staleTime: 30_000, retry: false,
    })
    const { tabProps } = useTabListKeyboard<TimeFilter>({ keys: TIME_FILTER_KEYS, active: period, onSelect: setPeriod, idFor: k => `gl-repositories-time-${k}` })
    const groups = useMemo(() => {
        const grouped = new Map<string, TRepository[]>()
        for (const repo of catalogue.data ?? []) {
            if (repo.status === "private") continue
            if (!`${repo.id} ${repo.description ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) continue
            const group = grouped.get(repo.owner) ?? []
            group.push(repo); grouped.set(repo.owner, group)
        }
        return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([org, repos]) => [org, repos.sort((a, b) => a.id.localeCompare(b.id))] as const)
    }, [catalogue.data, search])
    const stats = new Map(activity.data?.repositories.map(row => [row.repositoryId, row]))
    const total = catalogue.data?.filter(r => r.status !== "private").length
    const visible = groups.reduce((n, [, repos]) => n + repos.length, 0)
    return <div className="gl-page gl-repositories">
        <PageMeta title="Repositories | Dev Report · Memba" description="Public repositories tracked across the Gno ecosystem." />
        <div className="gl-header"><div><h1 className="gl-title">Repositories</h1><p className="gl-subtitle">Explore the public projects behind Dev Report.</p></div>{total !== undefined && <span className="gl-section-count">{total} tracked</span>}</div>
        <div className="gl-repositories-controls">
            <label className="gl-repository-search">Search repositories<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, organisation or description" /></label>
            <div role="tablist" aria-label="Repository activity period" className="gl-tabs">{TIME_FILTER_KEYS.map(key => <button key={key} {...tabProps(key)} onClick={() => setPeriod(key)} className={`gl-tab ${period === key ? "gl-tab--active" : ""}`}>{TIME_FILTER_LABELS[key]}</button>)}</div>
        </div>
        {catalogue.isLoading && <p role="status">Loading repositories…</p>}
        {catalogue.isError && <div className="gl-error-banner" role="alert"><span>Repository catalogue unavailable.</span><button className="gl-error-retry" onClick={() => catalogue.refetch()}>Retry</button></div>}
        {!catalogue.isError && catalogue.data && <>
            <p className="gl-repositories-note">{visible} of {total} repositories · Activity uses the selected period; open PRs show the current total.</p>
            {activity.isError && <p className="gl-warning-banner" role="status">Repository activity is unavailable. You can still browse the catalogue. <button className="gl-error-retry" onClick={() => activity.refetch()}>Retry activity</button></p>}
            {total === 0 ? <p>No repositories are tracked yet.</p> : visible === 0 ? <p role="status">No repositories match your search.</p> : groups.map(([org, repos]) => <section key={org} className="gl-section" aria-label={`${org} repositories`}>
                <h2 className="gl-section-title">{org} <span className="gl-section-count">{repos.length}</span></h2>
                <ul className="gl-repository-list">{repos.map(repo => {
                    const row = repo.lastSyncedAt && !repo.syncError ? stats.get(repo.id) : undefined
                    return <li key={repo.id} className="gl-repository-entry">
                        <div className="gl-repository-heading"><Link className="gl-repository-title" to={`${np("gnolove")}?repos=${encodeURIComponent(repo.id)}`}>{repo.id}</Link><span className="gl-repository-status">{STATUS_LABELS[repo.status ?? ""] ?? "Status unavailable"}</span></div>
                        {repo.description && <p className="gl-repository-description">{repo.description}</p>}
                        <dl className="gl-repository-metrics"><div><dt>Merged PRs</dt><dd>{row?.mergedPRs ?? "—"}</dd></div><div><dt>Open PRs</dt><dd>{row?.openPRs ?? "—"}</dd></div><div><dt>Contributors</dt><dd>{row?.contributors ?? "—"}</dd></div><div><dt>Stars</dt><dd>{repo.stars ?? "—"}</dd></div></dl>
                        <div className="gl-repository-footer"><span>{repo.language || repo.baseBranch}{repo.pushedAt ? ` · Last push ${formatRelativeTime(repo.pushedAt, nowMs)}` : ""}</span><a href={`https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`} target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
                        <small className="gl-repository-sync">{repo.syncError || (repo.lastSyncedAt ? `Last successful sync ${formatRelativeTime(repo.lastSyncedAt, nowMs)}` : repo.status === "unavailable" ? "History retained; sync stopped." : "Activity sync not confirmed yet.")}</small>
                    </li>
                })}</ul>
            </section>)}
        </>}
    </div>
}
