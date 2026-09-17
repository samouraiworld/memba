import { useState } from "react"
import { Link } from "react-router-dom"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import type { DAOProposal } from "../../lib/dao"
import { buildProposalsCsv } from "../../lib/dao/proposalsCsv"

const filters = ["All", "Open for voting", "Awaiting execution", "History"] as const
type Filter = typeof filters[number]
const matches = (p: DAOProposal, filter: Filter) => filter === "All" ||
    (filter === "Open for voting" ? p.status === "open" : filter === "Awaiting execution" ? p.status === "passed" : p.status === "executed" || p.status === "rejected" || p.status === "expired" || p.status === "invalidated")
/** Download the given proposals as a formula-neutralized CSV file. */
function exportProposalsCsv(encodedSlug: string, proposals: DAOProposal[]) {
    const blob = new Blob([buildProposalsCsv(proposals)], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${encodedSlug.split("/").pop() || "dao"}-proposals.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

const statusLabel: Record<DAOProposal["status"], string> = { open: "Open for voting", passed: "Awaiting execution", executed: "Executed", rejected: "Rejected", expired: "Expired", invalidated: "Membership changed" }

export function ProDAOProposals({ encodedSlug, proposals, loading, failed, retry, canPropose, votedIds }: {
    encodedSlug: string; proposals: DAOProposal[]; loading: boolean; failed: boolean;
    retry: () => void; canPropose: boolean; votedIds: Set<number>;
}) {
    const path = useNetworkPath()
    const [filter, setFilter] = useState<Filter>("All")
    const [search, setSearch] = useState("")
    const shown = proposals.filter(p => matches(p, filter) && `${p.id} ${p.title} ${p.author}`.toLowerCase().includes(search.trim().toLowerCase()))
    return <section id="dao-proposals-section" className="gov-proposals" aria-labelledby="gov-proposals-title" aria-busy={loading}>
        <div className="gov-section-header">
            <div><h3 id="gov-proposals-title">Proposals</h3><p>Follow decisions from discussion to execution.</p></div>
            <div className="gov-section-actions">
                {shown.length > 0 && <button type="button" className="k-btn-secondary" onClick={() => exportProposalsCsv(encodedSlug, shown)}>Export CSV</button>}
                {canPropose && <Link className="k-btn-primary" to={path(`dao/${encodedSlug}/propose`)}>New proposal</Link>}
            </div>
        </div>
        <div className="gov-list-toolbar">
            <div className="gov-filters" role="group" aria-label="Filter proposals by status">
                {filters.map(f => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}{" "}<span>{loading || failed ? "—" : proposals.filter(p => matches(p, f)).length}</span></button>)}
            </div>
            <label className="gov-search"><span>Search proposals</span><input type="search" placeholder="Title, author or number" value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        {failed && <div className="gov-read-notice" role="status"><p>{proposals.length ? "Could not refresh proposals. Showing previously loaded data." : "Could not load proposals."}</p><button className="k-btn-secondary" onClick={retry}>Retry proposals</button></div>}
        {loading ? <p className="gov-empty" role="status">Loading proposals…</p> : shown.length ? <>
            <p className="gov-result-count" role="status">{shown.length} {shown.length === 1 ? "proposal" : "proposals"}{failed ? " previously loaded" : ""}</p>
            <ul className="gov-proposal-list">{shown.map(p => <li key={p.id}>
                <Link className="gov-proposal-link" to={path(`dao/${encodedSlug}/proposal/${p.id}`)}>
                    <span className="gov-proposal-number">#{p.id}</span>
                    <span className="gov-proposal-content"><strong>{p.title || `Proposal #${p.id}`}</strong><span className="gov-proposal-meta">{p.author || "Author unavailable"}{p.category ? ` · ${p.category}` : ""}{votedIds.has(p.id) ? " · You voted" : ""}</span></span>
                    <span className={`gov-status gov-status--${p.status}`}>{statusLabel[p.status]}</span><span className="gov-row-arrow" aria-hidden="true">↗</span>
                </Link>
            </li>)}</ul>
        </> : !failed && <div className="gov-empty" role="status"><strong>{proposals.length ? "No matching proposals" : "No proposals yet"}</strong><p>{proposals.length ? "Try another status or search term." : "Proposals will appear here when they are created."}</p>{(search || filter !== "All") && <button className="k-btn-secondary" onClick={() => { setSearch(""); setFilter("All") }}>Clear filters</button>}</div>}
    </section>
}
