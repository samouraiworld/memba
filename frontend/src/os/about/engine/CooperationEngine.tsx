import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { DAO, FAMILIES, FEATURES, OPERATIONS, PACKAGES, RESERVE, REWARDS, STEWARDSHIP, publicTarget, type Brick } from "./engineInfo"
import "./engine.css"

const TABS = ["Engine", "Community", "Fees & rewards", "Roadmap"] as const
type Tab = typeof TABS[number]
const MOTION_QUERY = "(prefers-reduced-motion: reduce)"
function subscribeMotion(change: () => void) {
    const media = window.matchMedia?.(MOTION_QUERY)
    media?.addEventListener("change", change)
    return () => media?.removeEventListener("change", change)
}
const motionSnapshot = () => window.matchMedia?.(MOTION_QUERY).matches ?? false
const serverMotionSnapshot = () => true
const OS: Brick = { id: "os", name: "Memba OS", summary: "One workspace for your organisation", layer: "offchain", detail: "The browser is the workspace: windows, drafts, previews and transaction preparation. Wallets sign; Gno realms enforce the rules. Backend and external services provide indexing, coordination and media.", code: "https://github.com/samouraiworld/memba/tree/main/frontend/src/os" }
const SERVICES: Brick = { id: "services", name: "Services & local data", summary: "Indexes, media, meetings, drafts", layer: "offchain", detail: "The backend indexes public events, coordinates shared-wallet proposals and verifies activity. Media and video calls use external services. Browser drafts and preferences stay local. Keys and seed phrases are never published onchain, nor are raw calls or private review evidence intended for the public ledger.", code: "https://github.com/samouraiworld/memba/tree/main/backend" }

function Outside({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${typeof children === "string" ? children : "View source"} (opens in new tab)`}>{children}<span aria-hidden="true"> ↗</span></a>
}

function Tile({ brick, chainId, inspect }: { brick: Brick; chainId: string; inspect: (brick: Brick, trigger: HTMLButtonElement) => void }) {
    const target = publicTarget(brick, chainId)
    return <div className="os-engine-tile" data-layer={brick.layer}>
        <div className="os-engine-tile-main">
            {target ? <Outside href={target.href}>{brick.name}</Outside> : brick.code ? <Outside href={brick.code}>{brick.name}</Outside> : <strong>{brick.name}</strong>}
            <span>{brick.summary}</span>
        </div>
        <div className="os-engine-tile-meta"><span className="os-engine-tag" data-layer={brick.layer}>{brick.layer === "planned" ? "Planned" : brick.layer === "hybrid" ? "Hybrid" : brick.layer === "onchain" ? "Onchain" : "Offchain"}</span>
            {brick.available === false && <span className="os-sub os-engine-gate">Release gated</span>}
            <button type="button" className="os-engine-detail" data-inspect={brick.id} aria-label={`Details: ${brick.name}`} onClick={event => inspect(brick, event.currentTarget)}>Details</button>
        </div>
    </div>
}

export function CooperationEngine({ chainId, support }: { chainId: string; support: () => void }) {
    const id = useId()
    const root = useRef<HTMLDivElement>(null)
    const [tab, setTab] = useState<Tab>("Engine")
    const [playing, setPlaying] = useState(() => !motionSnapshot() && !document.hidden)
    const [selected, setSelected] = useState<Brick | null>(null)
    const [directory, setDirectory] = useState(false)
    const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot)
    const returnTo = useRef<{ id: string; scroll: number } | null>(null)
    const scrollBody = () => root.current?.closest<HTMLElement>(".os-wbody") ?? root.current
    const running = playing && !reduced && !selected && tab !== "Roadmap"
    const pause = () => setPlaying(false)
    const inspect = (brick: Brick, trigger: HTMLButtonElement) => {
        if (!selected) returnTo.current = { id: trigger.dataset.inspect ?? brick.id, scroll: scrollBody()?.scrollTop ?? 0 }
        pause()
        setSelected(brick)
    }
    const back = () => setSelected(null)

    // A hidden/parked OS window stops the tour. It never resumes on its own.
    useEffect(() => {
        const hidden = () => { if (document.hidden) setPlaying(false) }
        document.addEventListener("visibilitychange", hidden)
        const media = window.matchMedia?.(MOTION_QUERY)
        media?.addEventListener("change", pause)
        const el = root.current
        const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
            if (entries.some(entry => !entry.isIntersecting)) setPlaying(false)
        }) : undefined
        if (el) observer?.observe(el)
        const body = el?.closest(".os-wbody")
        body?.addEventListener("scroll", pause, { passive: true })
        return () => { document.removeEventListener("visibilitychange", hidden); media?.removeEventListener("change", pause); observer?.disconnect(); body?.removeEventListener("scroll", pause) }
    }, [])

    useEffect(() => {
        if (!running) return
        const timer = window.setTimeout(() => setTab(current => TABS[(TABS.indexOf(current) + 1) % 3]), 8_000)
        return () => window.clearTimeout(timer)
    }, [running, tab])

    useEffect(() => {
        if (selected) {
            root.current?.querySelector<HTMLButtonElement>(".os-engine-back")?.focus({ preventScroll: true })
            scrollBody()?.scrollTo?.({ top: root.current?.offsetTop ?? 0 })
        } else if (returnTo.current) {
            const { id: triggerId, scroll } = returnTo.current
            scrollBody()?.scrollTo?.({ top: scroll })
            Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-inspect]") ?? []).find(button => button.dataset.inspect === triggerId)?.focus({ preventScroll: true })
            returnTo.current = null
        }
    }, [selected])

    const tile = (brick: Brick) => <Tile key={brick.id} brick={brick} chainId={chainId} inspect={inspect} />
    const target = selected ? publicTarget(selected, chainId) : undefined
    const family = selected ? FAMILIES.find(group => group.name === selected.name) : undefined

    return <div ref={root} className="os-engine" data-running={running} onMouseEnter={pause} onFocusCapture={event => {
        if (!(event.target as HTMLElement).closest(".os-engine-play")) pause()
    }} onPointerDownCapture={event => {
        if (!(event.target as HTMLElement).closest(".os-engine-play")) pause()
    }} onWheel={pause}>
        <div className="os-engine-intro"><div><h3>The cooperation engine</h3><p>How the tools, the chain and the community fit together.</p></div>
            <button type="button" className="os-engine-play" aria-pressed={running} disabled={reduced || tab === "Roadmap" || !!selected} onClick={() => setPlaying(value => !value)}>{reduced ? "Manual view" : running ? "Pause tour" : "Play tour"}</button>
        </div>
        <nav className="os-engine-tabs" aria-label="Explore Memba">
            {TABS.map(name => <button type="button" key={name} aria-current={tab === name ? "page" : undefined} aria-controls={`${id}-panel`} onClick={() => { pause(); setSelected(null); setTab(name); returnTo.current = null }}>{name}</button>)}
        </nav>
        <div className="os-engine-panel" id={`${id}-panel`} role="region" aria-label={selected ? `${selected.name} details` : tab}>
            {selected ? <div className="os-engine-inspector">
                <button type="button" className="os-engine-back" onClick={back}>Back to {tab}</button>
                <h4>{selected.name}</h4><p>{selected.detail}</p>
                {selected.available === false && <p className="os-sub">Not enabled in this build. Source availability and feature availability are separate.</p>}
                {selected.account && <p className="os-engine-address os-mono">{selected.account}</p>}
                {target && <Outside href={target.href}>{target.kind === "Account" ? "Public account record" : "Published source"}</Outside>}
                {!target && (selected.realm || selected.account) && <p className="os-sub">No verified public target for this brick on {chainId}.</p>}
                {selected.code && <Outside href={selected.code}>Implementation on GitHub</Outside>}
                {family && <div className="os-engine-directory">{FEATURES.filter(feature => family.apps.some(app => app === feature.id)).map(tile)}</div>}
                {selected.id === DAO.id && <div className="os-engine-directory">{PACKAGES.map(tile)}</div>}
            </div> : <>
                {tab === "Engine" && <>
                    <div className="os-engine-map">
                        <div className="os-engine-families">{FAMILIES.map(group => <button type="button" key={group.name} data-inspect={group.name} onClick={event => inspect({ id: group.name, name: group.name, summary: group.summary, layer: "hybrid", detail: group.summary + ". Explore each tool and its source below." }, event.currentTarget)}><strong>{group.name}</strong><span>{group.summary}</span></button>)}</div>
                        <div className="os-engine-flow"><span>Use tools · prepare actions</span></div>
                        <div className="os-engine-pair">{tile(OS)}{tile(DAO)}</div>
                        <div className="os-engine-flow"><span>Wallets sign · realms enforce rules</span></div>
                        <div className="os-engine-foundation"><strong>Gno foundation</strong><span>Public state, rules and settled transactions</span><Outside href="https://github.com/gnolang/gno">Gno source</Outside></div>
                        {tile(SERVICES)}
                    </div>
                    <p className="os-engine-caption">The OS brings tools together. DAO authority grows through explicit application handovers.</p>
                    <button type="button" className="os-engine-expand" aria-expanded={directory} onClick={() => { pause(); setDirectory(value => !value) }}>{directory ? "Hide" : "Explore"} all {FEATURES.length} tools</button>
                    {directory && <div className="os-engine-directory">{FEATURES.map(tile)}</div>}
                </>}
                {tab === "Community" && <>
                    <p className="os-engine-caption">From founding crew to community stewardship.</p>
                    {tile(DAO)}
                    <ol className="os-engine-steps">
                        <li><strong>Core developers</strong><span>The Samouraï Coop crew establishes the DAO.</span></li>
                        <li><strong>Contributing users <em>Vision</em></strong><span>Users can put themselves forward; participation and useful contributions inform admission decisions.</span></li>
                        <li><strong>Trusted responsibilities <em>Vision</em></strong><span>NFT Launchpad reviewer, Feed moderator, feature administrator: roles granted through agreed policies.</span></li>
                        <li><strong>Contributor rewards <em>Vision</em></strong><span>Approved responsibilities can be rewarded from community revenue, subject to allocation decisions.</span></li>
                    </ol>
                    <p className="os-engine-caption">Activity builds trust. XP alone grants neither permissions nor payment. Joining community channels is distinct from receiving a DAO voting seat.</p>
                </>}
                {tab === "Fees & rewards" && <>
                    <p className="os-engine-caption"><strong>Target model.</strong> Fee-enabled features help sustain the OS and its contributors.</p>
                    <div className="os-engine-map os-engine-money-map">
                        <div className="os-engine-fee-inputs">{FEATURES.filter(feature => ["store", "market", "tokens", "nft"].includes(feature.id)).map(tile)}</div>
                        <div className="os-engine-flow" data-planned="true"><span>Application fees · planned convergence</span></div>
                        <div className="os-engine-pair">{tile(RESERVE)}{tile(DAO)}</div>
                        <div className="os-engine-flow" data-planned="true"><span>Memba DAO allocation policy · vision</span></div>
                        <div className="os-engine-pair">{tile(OPERATIONS)}{tile(REWARDS)}</div>
                    </div>
                    <p className="os-engine-caption">Operations funds the tools; rewards support contributors. These are proposed budgets or wallet roles, with no fixed distribution promised.</p>
                    <details className="os-engine-disclosure"><summary>Current custody and fees</summary>
                        <p>Each deployed feature defines its fee receiver and administrator. Inspect its source to see the current policy. The route above is the intended community model, not a claim that every fee already reaches the DAO.</p>{tile(STEWARDSHIP)}
                        <p>Network gas, storage deposits, escrow principal, creator proceeds and royalties are separate from Memba’s application revenue. Free tools do not generate fees just because they appear in the OS.</p>
                    </details>
                </>}
                {tab === "Roadmap" && <>
                    <p className="os-engine-caption"><strong>Gno at the core.</strong> Public rules and governance remain anchored in Gno.</p>
                    <div className="os-engine-road-core"><strong>Gno</strong><span>Core network</span></div>
                    <div className="os-engine-road-links" aria-hidden="true" />
                    <div className="os-engine-pair os-engine-road-futures">
                        <div><strong>EVM chains</strong><span className="os-engine-tag" data-layer="planned">Planned</span><p>Use EVM networks and manage assets together through DAO-governed tools.</p></div>
                        <div><strong>Bitcoin</strong><span className="os-engine-tag" data-layer="planned">Planned</span><p>Connect Bitcoin assets and shared fund management to organisations.</p></div>
                    </div>
                    <p className="os-engine-caption">Parallel directions, with no release order or dates committed. Signing, custody and governance rules still need to be designed for each network.</p>
                    <h4>Community horizon</h4>
                    <ul className="os-engine-horizon"><li><strong>User membership</strong> · contribution-based admission <em>Vision</em></li><li><strong>Trusted roles</strong> · reviewers, moderators, administrators <em>Vision</em></li><li><strong>Shared revenue</strong> · sustainable operations and contributor rewards <em>Vision</em></li></ul>
                </>}
            </>}
        </div>
        <div className="os-engine-legend" aria-label="Architecture legend">{["onchain", "hybrid", "offchain", "planned"].map(layer => <span key={layer} data-layer={layer}><i aria-hidden="true" />{layer === "onchain" ? "Onchain" : layer === "offchain" ? "Offchain" : layer === "hybrid" ? "Hybrid" : "Planned / vision"}</span>)}</div>
        <details className="os-engine-disclosure"><summary>What stays outside the chain?</summary><p>Keys and seed phrases stay with your wallet. Private evidence, raw meetings, local drafts and preferences stay offchain by design. Public media uses external storage with onchain references where needed; indexes and signature coordination can be replaced without rewriting settled chain state.</p></details>
        <p className="os-engine-manifesto">Built by zôÖma, Memba OS is an experimental operating system for organisations to cooperate, communicate and self-organise. Founded with the Samouraï Coop crew, it aims to become a community-owned ecosystem where contributions can lead to membership, trusted roles and rewards. Currently self-funded, Memba welcomes backers, contributors and supporters.</p>
        <button type="button" className="os-engine-expand" onClick={support}>Support Memba</button>
    </div>
}
