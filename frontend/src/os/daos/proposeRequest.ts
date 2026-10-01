/**
 * A new proposal as a signing request, on the classic form's machinery
 * (ProposeV2Form): the same plan and deposit ceiling, the same checks right
 * before the wallet opens (the DAO isn't archived, you're still a member, the
 * electorate hasn't changed), the same receipt scope ("proposal"), and the
 * new proposal ID from the submitting transaction when available.
 *
 * @module os/daos/proposeRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, type DaoAction } from "../../lib/dao"
import { broadcastDaoTx, planDaoTx, planNeedsDepositOverride, proposalIdFromTxResult } from "../../lib/dao/daoTx"
import { saveGovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import type { DaoKind, DaoProposalKind } from "../../lib/dao/kind"
import { type MembaV2Config } from "../../lib/dao/membaV2"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import { formatDuration } from "../../lib/templates/dao/v2/duration"
import type { GasPrice } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { sheetFee } from "./sheetFee"
import { TYPE_LABELS } from "./proposal"
import { withFeeCheck } from "../sign/recheck"

export function proposalScope(realmPath: string, caller: string): GovernanceScope {
    return { chainId: GNO_CHAIN_ID, realmPath, caller, operation: "proposal" }
}

/** The classic draft scope for a general (not link-prefilled) proposal. */
export function proposalDraftScope(realmPath: string, caller: string): GovernanceScope {
    return { ...proposalScope(realmPath, caller), operation: `proposal-draft:${JSON.stringify([null, null, null])}` }
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
    /** The network gas price quoted when the member asked to propose (see quoteGasPrice). */
    gasPrice: GasPrice
}

export function proposeRequest(ctx: ProposeContext): SignRequest<string> {
    const { realmPath, caller, config, action } = ctx
    const title = "title" in action ? action.title : ""
    const plan = planDaoTx(ctx.daoKind, realmPath, action, caller)
    const overCeiling = planNeedsDepositOverride(plan)
    const cap = plan.maxDepositUgnot
    const fee = sheetFee(plan, ctx.gasPrice)
    const scope = proposalScope(realmPath, caller)
    return {
        title: "Propose",
        summary: `Propose “${revealInvisibleFormatting(title)}”`,
        sub: `${TYPE_LABELS[ctx.proposalKind]} · ${revealInvisibleFormatting(ctx.daoName)}`,
        lines: () => [
            ["If it passes and is executed", revealInvisibleFormatting(ctx.effect)],
            ["Voting", `lasts ${formatDuration(config.voting_period)}`],
            ["Passes with", `${config.threshold} % yes${config.quorum ? `, ${config.quorum} % quorum` : ""}`],
            ...(cap !== undefined ? [["Storage deposit", `up to ${formatUgnot(cap)}`] as [string, string]] : []),
            fee.line,
            ["Network", GNO_CHAIN_ID],
        ],
        warns: ctx.proposalKind === "archive" ? ["Archiving is permanent once executed."] : [],
        acks: overCeiling && cap !== undefined ? [`I approve a storage-deposit cap of ${formatUgnot(cap)}, above the usual 10 GNOT limit.`] : [],
        note: "Memba re-checks the DAO, your membership and the fee before signing.",
        label: () => `Proposal “${revealInvisibleFormatting(title.length > 40 ? `${title.slice(0, 40)}…` : title)}”`,
        receipt: scope,
        retainConfirmedReceipt: true,
        prepare: () => ({ msgs: [plan.msg] }),
        recheck: async () => {
            const dao = Promise.all([getDAOConfig(GNO_RPC_URL, realmPath, true), getDAOMembers(GNO_RPC_URL, realmPath, undefined, true)])
            await withFeeCheck(dao, fee.assertStillCovers(), ([fresh, members]) => {
                if (!fresh?.v2 || fresh.v2.archived || !members.some((m) => m.address === caller)) throw new Error("DAO membership or availability changed. Review your proposal again.")
                if (fresh.v2.electorate_version !== config.electorate_version) throw new Error("DAO membership changed. Review the proposal again.")
            })
        },
        send: (_c, beforeSign) => broadcastDaoTx(plan, `Propose: ${title}`, beforeSign, { approvedDepositUgnot: overCeiling ? cap : undefined, fee: fee.fee }),
        verifyAttempts: 1,
        verify: async (_c, hash, result) => {
            // A matching author/title in a later list is not proof that this
            // transaction created it. Preserve the receipt when the wallet
            // supplied no transaction-correlated proposal ID.
            const id = proposalIdFromTxResult(result)
            if (id === null) return false
            try { saveGovernanceReceipt(scope, { phase: "confirmed", hash, label: title, proposalId: id }) } catch { /* kept in memory */ }
            ctx.onCreated(id)
            return true
        },
    }
}
