import { ArrowUpRight, Wallet, ArrowsLeftRight, ChatsCircle, Cube, MagnifyingGlass, Code } from "@phosphor-icons/react"
import { useSearchParams } from "react-router-dom"
import { ECOSYSTEM_CATEGORIES, filterEcosystemProjects, type EcosystemFilters } from "../../lib/ecosystemDirectory"
import { parseEcosystemFilters, updateEcosystemFilters } from "../../lib/ecosystemDirectoryUrl"
import { ExplorerLink } from "../directory/ExplorerLink"
import "./ecosystem-directory.css"

const ICONS = { Wallet, Exchange: ArrowsLeftRight, Community: ChatsCircle, "Creative worlds": Cube, Explorer: MagnifyingGlass, "Developer tools": Code }

export function EcosystemDirectory({ standalone = false }: { standalone?: boolean }) {
    const [params, setParams] = useSearchParams()
    const filters = parseEcosystemFilters(params)
    const projects = filterEcosystemProjects(filters)
    const update = (patch: Partial<EcosystemFilters>) => setParams(previous => updateEcosystemFilters(previous, patch), { replace: Object.keys(patch).every(key => key === "q") })
    return (
        <section className="ecosystem-directory" aria-label="Gno ecosystem apps">
            <header className="ecosystem-directory__header">
                <p className="ecosystem-directory__eyebrow">Built on Gno</p>
                <h1>App Store</h1>
                <p>Tools for your next idea. Discover wallets, communities, creative worlds, and apps built around Gno.</p>
            </header>
            <div className="ecosystem-directory__filters" role="search" aria-label="Find ecosystem projects">
                <label>Search projects<input type="search" maxLength={200} value={filters.q} onChange={event => update({ q: event.target.value })} placeholder="Name, category or realm path" /></label>
                <label>Category<select value={filters.category} onChange={event => update({ category: parseEcosystemFilters(new URLSearchParams({ category: event.target.value })).category })}>
                    <option value="all">All categories</option>
                    {ECOSYSTEM_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select></label>
                <label>Availability<select value={filters.availability} onChange={event => update({ availability: parseEcosystemFilters(new URLSearchParams({ availability: event.target.value })).availability })}>
                    <option value="all">All availability</option><option value="mainnet">Mainnet</option><option value="testnet">Testnet</option><option value="tools">Tools</option><option value="unknown">Not verified</option>
                </select></label>
                <button type="button" onClick={() => update({ q: "", category: "all", availability: "all" })}>Reset filters</button>
            </div>
            <p className="ecosystem-directory__note">Filters browse the whole ecosystem; they do not change your Memba network. Each destination’s network is shown below.</p>
            <p className="ecosystem-directory__count" role="status">{projects.length} project{projects.length === 1 ? "" : "s"} found</p>
            {projects.length === 0 && <p>No projects match these filters. Try another search or reset the filters.</p>}
            <ul className="ecosystem-directory__grid">
                {projects.map(project => {
                    const Icon = ICONS[project.category]
                    return <li key={project.id}><article className="ecosystem-app">
                        <div className="ecosystem-app__top"><span className="ecosystem-app__icon"><Icon size={26} aria-hidden="true" /></span><span>{project.category}</span></div>
                        <h2>{project.name}</h2><p>{project.description}</p>
                        <p className="ecosystem-app__availability">{project.availability}</p>
                        <div className="ecosystem-app__links">
                            <a href={project.url} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${project.name} (opens in a new tab)`}>Open {project.name}<ArrowUpRight size={16} aria-hidden="true" /></a>
                            {project.realm && <a href={project.realm.url} target="_blank" rel="noopener noreferrer" aria-label={`${project.name} mainnet realm (opens in a new tab)`}>Mainnet realm ↗</a>}
                            {project.sourceUrl && <a href={project.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${project.name} source (opens in a new tab)`}>Source ↗</a>}
                            {project.realm && <ExplorerLink realmPath={project.realm.path} networkKey={project.realm.network} label="Mainnet Explorer" />}
                        </div>
                        <div className="ecosystem-app__footer"><span>{project.status}</span><span>{new URL(project.url).hostname}</span></div>
                        <p className="ecosystem-app__checked">Links checked {project.evidence.checkedAt}</p>
                    </article></li>
                })}
            </ul>
            <p className="ecosystem-directory__note">These links open independent projects outside Memba. Read access and network selection do not establish transaction readiness.{!standalone && " Ecosystem links are separate from the on-chain listings below."}</p>
            {standalone && <div className="ecosystem-directory__registry"><h2>On-chain listings are unavailable here</h2><p>Browse the ecosystem above while Memba’s publishing and review features are unavailable on this network.</p></div>}
        </section>
    )
}
