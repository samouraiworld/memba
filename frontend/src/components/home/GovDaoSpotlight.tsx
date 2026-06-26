/**
 * GovDaoSpotlight — the gold Layer-1 governance spotlight for the home board.
 *
 * GovDAO (gno.land/r/gov/dao) is the chain-level constitutional DAO every user
 * should monitor, so it gets a visually distinct GOLD treatment (vs. teal for
 * community surfaces). Two columns:
 *   - left identity rail: eyebrow + name + description + "Monitor governance"
 *     CTA + live stats (open proposals / members / threshold), each omitted when
 *     absent (honesty); retry on error.
 *   - right "latest governance" rail: previews the newest proposals (each a deep
 *     link to that proposal), filling what used to be dead space. Honest empty
 *     ("No proposals yet"), loading (skeleton) and error (hidden) states.
 *
 * Driven by useGovDao — always renders (GovDAO always exists). All data comes
 * from the SAME config/proposals already fetched for the counts; no extra RPC.
 *
 * @module components/home/GovDaoSpotlight
 */
import { Link } from "react-router-dom"
import { useGovDao, type GovDaoProposalPreview } from "../../hooks/home/useGovDao"
import "./home.css"

export interface GovDaoSpotlightProps {
    networkKey: string
}

function ProposalRow({ p }: { p: GovDaoProposalPreview }) {
    return (
        <Link to={p.href} className="govdao-spotlight__prop">
            <span className={`govdao-spotlight__prop-dot govdao-spotlight__prop-dot--${p.status}`} aria-hidden="true" />
            <span className="govdao-spotlight__prop-title">{p.title}</span>
            <span className="govdao-spotlight__prop-meta">
                {p.status}
                {p.yesPercent !== undefined && (
                    <>
                        <span className="govdao-spotlight__sep" aria-hidden="true"> · </span>
                        {p.yesPercent}%
                    </>
                )}
            </span>
        </Link>
    )
}

export function GovDaoSpotlight({ networkKey }: GovDaoSpotlightProps) {
    const gov = useGovDao(networkKey)
    const proposals = gov.latestProposals ?? []

    return (
        <section className="govdao-spotlight" data-testid="govdao-spotlight">
            {/* Left identity rail */}
            <div className="govdao-spotlight__main">
                <span className="govdao-spotlight__eyebrow">★ layer 1 · core governance</span>
                <span className="govdao-spotlight__name">{gov.name}</span>
                <p className="govdao-spotlight__desc">
                    The constitution of gno.land — it decides the network&apos;s future.
                </p>
                <div className="govdao-spotlight__row">
                    <Link to={gov.href} className="govdao-spotlight__cta">
                        Monitor governance
                    </Link>
                    {gov.openCount !== undefined && (
                        <span className="govdao-spotlight__stat">
                            {gov.openCount} {gov.openCount === 1 ? "open proposal" : "open proposals"}
                        </span>
                    )}
                    {gov.members !== undefined && (
                        <span className="govdao-spotlight__stat govdao-spotlight__stat--muted">
                            {gov.members} {gov.members === 1 ? "member" : "members"}
                        </span>
                    )}
                    {gov.threshold !== undefined && (
                        <span className="govdao-spotlight__stat govdao-spotlight__stat--muted">
                            {gov.threshold} threshold
                        </span>
                    )}
                    {gov.state === "error" && (
                        <button type="button" className="govdao-spotlight__retry" onClick={gov.refetch}>
                            retry
                        </button>
                    )}
                </div>
            </div>

            {/* Right "latest governance" rail — fills the previously-empty half */}
            {gov.state !== "error" && (
                <div className="govdao-spotlight__feed">
                    <span className="govdao-spotlight__feed-label">latest governance</span>
                    {gov.state === "loading" ? (
                        <div className="govdao-spotlight__feed-skeleton" aria-hidden="true">
                            <span /><span /><span />
                        </div>
                    ) : proposals.length === 0 ? (
                        <p className="govdao-spotlight__feed-empty">No proposals yet.</p>
                    ) : (
                        <>
                            <div className="govdao-spotlight__feed-list">
                                {proposals.map((p) => <ProposalRow key={p.id} p={p} />)}
                            </div>
                            <Link to={gov.href} className="govdao-spotlight__feed-all">
                                view all proposals →
                            </Link>
                        </>
                    )}
                </div>
            )}
        </section>
    )
}
