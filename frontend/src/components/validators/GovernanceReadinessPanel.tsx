/**
 * GovernanceReadinessPanel — who can change the validator set, and how much
 * failure the network can absorb right now.
 *
 * This is what replaced a rejected feature: a UI to draft a GovDAO proposal
 * ejecting a "misbehaving" validator. It is deliberately read-only. It explains;
 * it never prompts. There is no button, link or form here, and a test pins that
 * — the moment a detection surface grows a call to action against a named
 * operator, it becomes the thing that was rejected.
 *
 * Two facts it puts on screen:
 *  - GovDAO membership. Only members can create proposals, and a validator-set
 *    change needs one. On gnoland-1 there is exactly one member.
 *  - Failure tolerance, today and with the largest validator gone. On the live
 *    4 x 60 set, losing any one validator leaves a network that any single
 *    remaining operator could halt — and a halted chain cannot pass the proposal
 *    that would fix it.
 */

import type { GovernanceReadiness } from "../../lib/governanceReadiness"
import "./GovernanceReadinessPanel.css"

interface GovernanceReadinessPanelProps {
    readiness: GovernanceReadiness
    /** True while GovDAO membership is still being read. */
    membershipLoading: boolean
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function GovernanceReadinessPanel({ readiness, membershipLoading }: GovernanceReadinessPanelProps) {
    const { govdao, liveness, afterLosingLargest, singleMemberGovernance } = readiness

    let whatIf: string | null = null
    if (afterLosingLargest) {
        whatIf = `If the largest validator went offline or were removed: ${plural(afterLosingLargest.validatorCount, "validator")}, `
            + `quorum ${afterLosingLargest.quorum} of ${afterLosingLargest.totalVotingPower}, `
            + `able to lose ${plural(afterLosingLargest.faultTolerance, "more validator")} without halting.`
        if (afterLosingLargest.faultTolerance < 1) {
            whatIf += " Any single remaining validator could then halt consensus — and a halted chain cannot pass the proposal that would fix it."
        }
    }

    return (
        <section className="gov-ready" aria-labelledby="gov-ready-title" data-testid="governance-readiness">
            <h2 id="gov-ready-title" className="gov-ready__title">Governance readiness</h2>
            <p className="gov-ready__lede">
                Who can change the validator set, and how much failure the network can absorb right now.
            </p>

            <div className="gov-ready__grid">
                <div className="gov-ready__block">
                    <h3 className="gov-ready__h">Who can act</h3>
                    {membershipLoading ? (
                        <p className="gov-ready__text">Reading GovDAO membership…</p>
                    ) : govdao ? (
                        <>
                            <p className="gov-ready__stat">{plural(govdao.memberCount, "GovDAO member")}</p>
                            <ul className="gov-ready__tiers" aria-label="Members by tier">
                                {govdao.tiers.map((t) => (
                                    <li key={t.tier} className="gov-ready__tier">
                                        {`${t.tier}: ${t.memberCount} (power ${t.power})`}
                                    </li>
                                ))}
                            </ul>
                            <p className="gov-ready__text">
                                Adding or removing a validator requires a GovDAO proposal, and only GovDAO members can create one.
                            </p>
                            {singleMemberGovernance && (
                                <p className="gov-ready__text">
                                    A single member can currently create and pass such a proposal alone.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="gov-ready__text">GovDAO membership couldn't be read from the chain.</p>
                    )}
                </div>

                <div className="gov-ready__block">
                    <h3 className="gov-ready__h">Failure tolerance</h3>
                    {liveness.validatorCount === 0 ? (
                        <p className="gov-ready__text">No active validators reported.</p>
                    ) : (
                        <>
                            <dl className="gov-ready__stats">
                                <dt>Active validators</dt>
                                <dd>{liveness.validatorCount}</dd>
                                <dt>Voting power needed to commit a block</dt>
                                <dd>{`${liveness.quorum} of ${liveness.totalVotingPower}`}</dd>
                                <dt>Can go offline without halting</dt>
                                <dd>{plural(liveness.faultTolerance, "validator")}</dd>
                            </dl>
                            {whatIf && (
                                <p className={`gov-ready__whatif${afterLosingLargest!.faultTolerance < 1 ? " gov-ready__whatif--danger" : ""}`}>
                                    {whatIf}
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </section>
    )
}
