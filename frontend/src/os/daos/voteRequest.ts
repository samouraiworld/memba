/**
 * A vote as a signing request. Version-2 DAOs get the classic proposal page's
 * checks right before the wallet opens (V2ProposalView: the DAO isn't
 * archived, you are still a member, the electorate hasn't changed, you haven't
 * voted, voting is still open) and the same deposit ceiling. GovDAO and
 * version-1 votes get the same message builder the classic page uses, plus a
 * fresh "still open" check. Receipts share the classic scope, so an unknown
 * outcome locks the vote in both interfaces.
 *
 * @module os/daos/voteRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, getProposalDetail, type VoteChoice } from "../../lib/dao"
import { broadcastDaoTx, planDaoTx, planNeedsDepositOverride, type DaoTxPlan } from "../../lib/dao/daoTx"
import type { GovernanceScope } from "../../lib/dao/governanceRecovery"
import type { DaoKind } from "../../lib/dao/kind"
import { readV2Proposal, readV2Votes } from "../../lib/dao/membaV2"
import { hasVotedOnV2, v2Context } from "../../lib/dao/membaV2Shell"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { canVoteNow, VOTES_ARE_FINAL } from "../../lib/dao/v2Lifecycle"
import type { SignRequest } from "../sign/signer"
import type { ProposalView } from "./useOsDao"

export const VOTE_OPTIONS = ["Yes", "No", "Abstain"] as const
export type VoteOption = (typeof VOTE_OPTIONS)[number]
const CHOICE: Record<VoteOption, VoteChoice> = { Yes: "YES", No: "NO", Abstain: "ABSTAIN" }

export function voteScope(realmPath: string, caller: string, id: number): GovernanceScope {
    return { chainId: GNO_CHAIN_ID, realmPath, caller, operation: `vote:${id}` }
}

export interface VoteContext {
    kind: DaoKind
    realmPath: string
    daoName: string
    proposal: ProposalView
    caller: string
    /** Version-2: the electorate version the member saw. */
    electorateVersion: number | null
    /** Version-2: the member's voting power, when known. */
    power: number | null
}

export function voteRequest(ctx: VoteContext): SignRequest<VoteOption> {
    const { kind, realmPath, proposal, caller } = ctx
    const v2 = kind === "memba-v2"
    const action = (choice: VoteOption) => ({ type: "vote" as const, id: proposal.id, vote: CHOICE[choice] })
    const plan = (choice: VoteOption | undefined): DaoTxPlan => planDaoTx(kind, realmPath, action(choice ?? "Yes"), caller)
    // The cap is the same for every choice; the classic page asks for the exact amount above the ceiling.
    const sample = plan("Yes")
    const overCeiling = planNeedsDepositOverride(sample)
    const cap = sample.maxDepositUgnot
    const memo = (choice: VoteOption | undefined) => `Vote ${CHOICE[choice ?? "Yes"]} on proposal #${proposal.id}`

    return {
        title: "Vote",
        summary: `Vote on #${proposal.id} “${proposal.title}”`,
        sub: ctx.daoName,
        choice: { label: "Your vote", options: VOTE_OPTIONS, initial: "Yes" },
        lines: (choice) => [
            ["Your vote", choice ?? "Yes"],
            ...(ctx.power !== null ? [["Your voting power", `${ctx.power} of ${proposal.whole}`] as [string, string]] : []),
            ...(cap !== undefined ? [["Storage deposit", `up to ${formatUgnot(cap)}`] as [string, string]] : []),
            ["Network", GNO_CHAIN_ID],
        ],
        acks: overCeiling && cap !== undefined ? [`I approve a storage-deposit cap of ${formatUgnot(cap)}, above the usual 10 GNOT limit.`] : [],
        note: v2 ? VOTES_ARE_FINAL : "Votes are final.",
        label: (choice) => `Vote ${choice ?? "Yes"} on #${proposal.id}`,
        receipt: voteScope(realmPath, caller, proposal.id),
        prepare: (choice) => ({ msgs: [plan(choice).msg] }),
        recheck: v2
            ? async () => {
                const [config, members, fresh, voted] = await Promise.all([
                    getDAOConfig(GNO_RPC_URL, realmPath, true),
                    getDAOMembers(GNO_RPC_URL, realmPath, undefined, true),
                    readV2Proposal(v2Context(GNO_RPC_URL, realmPath), proposal.id),
                    hasVotedOnV2(GNO_RPC_URL, realmPath, proposal.id, caller),
                ])
                if (!config?.v2 || config.v2.archived || !members.some((m) => m.address === caller)) throw new Error("DAO membership or availability changed. Review the action again.")
                if (config.v2.electorate_version !== ctx.electorateVersion || fresh.electorate_version !== config.v2.electorate_version) throw new Error("The proposal electorate changed. Refresh before signing.")
                if (voted !== false || !canVoteNow(fresh, Math.floor(Date.now() / 1000))) throw new Error("This vote is no longer available. Refresh the proposal.")
            }
            : async () => {
                const fresh = await getProposalDetail(GNO_RPC_URL, realmPath, proposal.id)
                if (!fresh || fresh.status !== "open") throw new Error("This proposal is no longer open for votes. Refresh it.")
            },
        send: (choice, beforeSign) => broadcastDaoTx(plan(choice), action(choice ?? "Yes"), memo(choice), beforeSign,
            { approvedDepositUgnot: overCeiling ? cap : undefined }),
        verify: v2
            ? async (choice) => {
                if (!(await hasVotedOnV2(GNO_RPC_URL, realmPath, proposal.id, caller))) return false
                const votes = await readV2Votes(v2Context(GNO_RPC_URL, realmPath), proposal.id)
                return votes.votes.some((v) => v.voter === caller && v.choice === CHOICE[choice ?? "Yes"])
            }
            : undefined,
    }
}
