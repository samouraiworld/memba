/**
 * A new proposal as a signing request, on the classic form's machinery
 * (ProposeV2Form): the same plan and deposit ceiling, the same checks right
 * before the wallet opens (the DAO isn't archived, you're still a member, the
 * electorate hasn't changed), the same receipt scope ("proposal"), and the
 * same way of finding the new proposal's id afterwards.
 *
 * @module os/daos/proposeRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, type DaoAction } from "../../lib/dao"
import { broadcastDaoTx, planDaoTx, planNeedsDepositOverride, proposalIdFromTxResult } from "../../lib/dao/daoTx"
import { saveGovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import type { DaoKind, DaoProposalKind } from "../../lib/dao/kind"
import { readV2Proposals, type MembaV2Config } from "../../lib/dao/membaV2"
import { v2Context } from "../../lib/dao/membaV2Shell"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { formatDuration } from "../../lib/templates/dao/v2/duration"
import type { SignRequest } from "../sign/signer"
import { TYPE_LABELS } from "./proposal"

export function proposalScope(realmPath: string, caller: string): GovernanceScope {
    return { chainId: GNO_CHAIN_ID, realmPath, caller, operation: "proposal" }
}

/** The classic draft scope for a general (not link-prefilled) proposal. */
export function proposalDraftScope(realmPath: string, caller: string): GovernanceScope {
    return { ...proposalScope(realmPath, caller), operation: `proposal-draft:${JSON.stringify([null, null, null])}` }
}

async function findCreatedProposal(realmPath: string, author: string, title: string, after: number): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const page = await readV2Proposals(v2Context(GNO_RPC_URL, realmPath), 0, 20)
            const match = page.proposals.find((p) => p.author === author && p.title === title && p.id > after)
            if (match) return match.id
        } catch { /* the node may not have the new block yet */ }
        await new Promise((r) => setTimeout(r, 1500))
    }
    return null
}

export interface ProposeContext {
    daoKind: DaoKind
    realmPath: string
    daoName: string
    caller: string
    config: MembaV2Config
    proposalKind: DaoProposalKind
    action: DaoAction
    effect: string
    onCreated: (id: number) => void
}

export function proposeRequest(ctx: ProposeContext): SignRequest<string> {
    const { realmPath, caller, config, action } = ctx
    const title = "title" in action ? action.title : ""
    const plan = planDaoTx(ctx.daoKind, realmPath, action, caller)
    const overCeiling = planNeedsDepositOverride(plan)
    const cap = plan.maxDepositUgnot
    const scope = proposalScope(realmPath, caller)
    const before = config.proposal_count
    return {
        title: "Propose",
        summary: `Propose “${title}”`,
        sub: `${TYPE_LABELS[ctx.proposalKind]} · ${ctx.daoName}`,
        lines: () => [
            ["If it passes", ctx.effect],
            ["Voting", `lasts ${formatDuration(config.voting_period)}`],
            ["Passes with", `${config.threshold} % yes${config.quorum ? `, ${config.quorum} % quorum` : ""}`],
            ...(cap !== undefined ? [["Storage deposit", `up to ${formatUgnot(cap)}`] as [string, string]] : []),
            ["Network", GNO_CHAIN_ID],
        ],
        warns: ctx.proposalKind === "archive" ? ["Archiving is permanent once executed."] : [],
        acks: overCeiling && cap !== undefined ? [`I approve a storage-deposit cap of ${formatUgnot(cap)}, above the usual 10 GNOT limit.`] : [],
        note: "Memba re-checks the DAO and your membership right before you sign.",
        label: () => `Proposal “${title.length > 40 ? `${title.slice(0, 40)}…` : title}”`,
        receipt: scope,
        prepare: () => ({ msgs: [plan.msg] }),
        recheck: async () => {
            const [fresh, members] = await Promise.all([getDAOConfig(GNO_RPC_URL, realmPath, true), getDAOMembers(GNO_RPC_URL, realmPath, undefined, true)])
            if (!fresh?.v2 || fresh.v2.archived || !members.some((m) => m.address === caller)) throw new Error("DAO membership or availability changed. Review your proposal again.")
            if (fresh.v2.electorate_version !== config.electorate_version) throw new Error("DAO membership changed. Review the proposal again.")
        },
        send: (_c, beforeSign) => broadcastDaoTx(plan, action, `Propose: ${title}`, beforeSign, { approvedDepositUgnot: overCeiling ? cap : undefined }),
        verify: async (_c, hash, result) => {
            const id = proposalIdFromTxResult(result) ?? await findCreatedProposal(realmPath, caller, title, before)
            if (id === null) return false
            try { saveGovernanceReceipt(scope, { phase: "confirmed", hash, label: title, proposalId: id }) } catch { /* kept in memory */ }
            ctx.onCreated(id)
            return true
        },
    }
}
