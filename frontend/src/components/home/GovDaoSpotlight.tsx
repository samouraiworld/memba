/**
 * GovDaoSpotlight — the gold Layer-1 governance spotlight for the home board.
 *
 * Replaces the MembaDAO featured hero: GovDAO (gno.land/r/gov/dao) is the
 * chain-level constitutional DAO every user should monitor, so it gets a
 * visually distinct GOLD treatment (vs. teal for community surfaces). Driven by
 * useGovDao — always renders (GovDAO always exists); shows live open-proposal /
 * member counts when present (omitted when absent — honesty); retry on error.
 *
 * @module components/home/GovDaoSpotlight
 */
import { Link } from "react-router-dom"
import { useGovDao } from "../../hooks/home/useGovDao"
import "./home.css"

export interface GovDaoSpotlightProps {
    networkKey: string
}

export function GovDaoSpotlight({ networkKey }: GovDaoSpotlightProps) {
    const gov = useGovDao(networkKey)

    return (
        <section className="govdao-spotlight" data-testid="govdao-spotlight">
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
                    <span className="govdao-spotlight__stat">{gov.openCount} open proposals</span>
                )}
                {gov.members !== undefined && (
                    <span className="govdao-spotlight__stat govdao-spotlight__stat--muted">
                        {gov.members} members
                    </span>
                )}
                {gov.state === "error" && (
                    <button type="button" className="govdao-spotlight__retry" onClick={gov.refetch}>
                        retry
                    </button>
                )}
            </div>
        </section>
    )
}
