import type { DAOProposal, VoteRecord } from "../../lib/dao"

/** A reading summary, never a prediction of whether an on-chain condition passes. */
export function ProProposalVotes({ proposal, records, members, threshold }: {
    proposal: DAOProposal; records: VoteRecord[]; members: number; threshold?: string;
}) {
    const yes = proposal.yesVotes || records.reduce((n, r) => n + r.yesVoters.length, 0)
    const no = proposal.noVotes || records.reduce((n, r) => n + r.noVoters.length, 0)
    const abstain = proposal.abstainVotes || records.reduce((n, r) => n + r.abstainVoters.length, 0)
    const total = yes + no + abstain
    return <section className="k-card gov-vote-summary" aria-label="Recorded votes">
        <div className="gov-vote-heading"><h4>Recorded votes</h4><span>{total > 0 ? `${total} reported` : "Not available"}</span></div>
        {total > 0 ? <dl className="gov-vote-counts">
            <div><dt>Yes</dt><dd>{yes}</dd></div><div><dt>No</dt><dd>{no}</dd></div><div><dt>Abstain</dt><dd>{abstain}</dd></div>
        </dl> : <p>Vote totals are unavailable or have not yet been recorded.</p>}
        <dl className="gov-vote-context"><div><dt>DAO members</dt><dd>{members > 0 ? members : "Unavailable"}</dd></div><div><dt>DAO threshold</dt><dd>{threshold || "Unavailable"}</dd></div></dl>
        <p className="gov-vote-note">Reported counts may be incomplete. Proposal conditions can differ from the DAO threshold; review the realm source and action before voting or executing.</p>
    </section>
}
