/**
 * Executing an accepted version-2 proposal as a signing request. The contract
 * lets a member execute it between `executable_at` and `execute_by`; right
 * before the wallet opens, Memba re-reads what the classic proposal page checks
 * (V2ProposalView: the DAO isn't archived, you are still a member, the
 * electorate hasn't changed, the window is open), what the contract validates
 * again at execution (the action still fits the members), and the fee. The
 * receipt shares the classic scope, so an unknown outcome locks Execute in both
 * interfaces.
 *
 * @module os/daos/executeRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { getDAOConfig, getDAOMembers, type DAOMember } from "../../lib/dao"
import { broadcastDaoTx, planDaoTx } from "../../lib/dao/daoTx"
import type { GovernanceScope } from "../../lib/dao/governanceRecovery"
import { readV2Proposal, type MembaV2Proposal } from "../../lib/dao/membaV2"
import { v2Context } from "../../lib/dao/membaV2Shell"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { executionState, formatChainTime, V2_ACTION_LABELS, type V2Proposal } from "../../lib/dao/v2Lifecycle"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import type { GasPrice } from "../../lib/grc20"
import { REALM_LIMITS } from "../../lib/templates/dao/v2/realm"
import { withFeeCheck } from "../sign/recheck"
import type { SignRequest } from "../sign/signer"
import { verifySendTx } from "../wallet/sendRequest"
import { sheetFee } from "./sheetFee"

export function executeScope(realmPath: string, caller: string, id: number): GovernanceScope {
    return { chainId: GNO_CHAIN_ID, realmPath, caller, operation: `execute:${id}` }
}

/**
 * Memba offers Execute a little inside the contract's window, since the block
 * time can lead or trail this clock: from 10 s after it opens to 30 s before it
 * closes ("closing").
 */
export function executeWindow(p: V2Proposal, nowSeconds: number): ReturnType<typeof executionState> | "closing" {
    const state = executionState(p, nowSeconds)
    if (state !== "open") return state
    if (nowSeconds < p.executable_at + 10) return "too-early"
    if (nowSeconds > p.execute_by - 30) return "closing"
    return "open"
}

/** The contract validates the action again when it is executed (realm validateAction): the same refusals, worded. */
export function actionProblem(a: MembaV2Proposal["action"], members: DAOMember[]): string | null {
    const target = members.find((m) => m.address === a.target)
    const refused = (why: string) => `${why}, so the chain would refuse this execution.`
    switch (a.kind) {
        case "add_member":
            if (target) return refused(`${a.target} is already a member`)
            if (members.length >= REALM_LIMITS.maxMembers) return refused(`The DAO already has ${REALM_LIMITS.maxMembers} members, its limit`)
            return null
        case "remove_member": {
            if (!target) return refused(`${a.target} is no longer a member`)
            // Every member holds at least 1 power, so this also refuses removing the last member.
            const total = members.reduce((sum, m) => sum + m.votingPower, 0)
            if (total - target.votingPower < 1) return refused(`${a.target} is the DAO's last member with voting power`)
            return null
        }
        case "set_roles":
            return target ? null : refused(`${a.target} is no longer a member`)
        default:
            return null
    }
}

export interface ExecuteContext {
    realmPath: string
    daoName: string
    proposal: MembaV2Proposal
    caller: string
    /** The DAO's electorate when the member asked to execute. */
    electorateVersion: number
    /** The network gas price quoted when the member asked to execute. */
    gasPrice: GasPrice
    /** Reads the DAO again when the re-check finds it changed, so the next attempt starts from fresh data. */
    refresh: () => void
}

/** What executing it changes, as review lines. */
function effectLines(p: MembaV2Proposal): [string, string][] {
    const a = p.action
    return [
        ["Action", V2_ACTION_LABELS[a.kind]],
        ...(a.target ? [["Member", a.target] as [string, string]] : []),
        ...(a.kind === "add_member" ? [["Voting power", a.power.toLocaleString("en-US")] as [string, string]] : []),
        ...(a.kind === "add_member" || a.kind === "set_roles" ? [["Roles", a.roles.length > 0 ? a.roles.join(", ") : "No roles"] as [string, string]] : []),
        ...(a.kind === "text" ? [["Effect", "None on chain; the decision is recorded."] as [string, string]] : []),
        ...(a.kind === "archive" ? [["Effect", "Permanent: no more proposals, votes or executions."] as [string, string]] : []),
    ]
}

export function executeRequest(ctx: ExecuteContext): SignRequest {
    const { realmPath, proposal, caller } = ctx
    // A deposit cap above the ceiling is refused by the broadcaster: no template DAO's execution reaches it.
    const plan = planDaoTx("memba-v2", realmPath, { type: "execute", id: proposal.id }, caller, { kind: proposal.action.kind, roles: proposal.action.roles })
    const cap = plan.maxDepositUgnot
    const fee = sheetFee(plan, ctx.gasPrice)
    const memo = `Execute proposal #${proposal.id}`
    const membership = proposal.action.kind === "add_member" || proposal.action.kind === "remove_member"
    let pendingNote: string | undefined
    let failedNote: string | undefined

    const stateCheck = async () => {
        const [config, members, fresh] = await Promise.all([
            getDAOConfig(GNO_RPC_URL, realmPath, true),
            getDAOMembers(GNO_RPC_URL, realmPath, undefined, true),
            readV2Proposal(v2Context(GNO_RPC_URL, realmPath), proposal.id),
        ])
        try {
            if (!config?.v2 || config.v2.archived || !members.some((m) => m.address === caller)) throw new Error("DAO membership or availability changed. Review the action again.")
            if (config.v2.electorate_version !== ctx.electorateVersion) throw new Error("The DAO's members changed. Refresh before signing.")
            if (executeWindow(fresh, Math.floor(Date.now() / 1000)) !== "open") throw new Error("This proposal cannot be executed now. Refresh its status.")
            const problem = actionProblem(fresh.action, members)
            if (problem) throw new Error(problem)
        } catch (err) {
            ctx.refresh()
            throw err
        }
    }

    return {
        title: "Execute",
        summary: `Execute #${proposal.id} “${revealInvisibleFormatting(proposal.title)}”`,
        sub: revealInvisibleFormatting(ctx.daoName),
        lines: () => [
            ...effectLines(proposal),
            ["Who may execute", `Any member, until ${formatChainTime(proposal.execute_by)}`],
            ...(cap !== undefined ? [["Storage deposit", `up to ${formatUgnot(cap)}`] as [string, string]] : []),
            fee.line,
            ["Network", GNO_CHAIN_ID],
        ],
        warns: [
            ...(membership ? ["Changing membership closes every proposal still open for voting: they become invalidated."] : []),
            ...(proposal.action.kind === "remove_member" ? ["The storage deposit freed by removing this member is refunded to you, as the account that executes the removal."] : []),
            ...(proposal.action.kind === "archive" ? ["Archiving is permanent."] : []),
        ],
        note: "Memba re-checks the DAO, your membership, the execution window, the action and the fee before signing.",
        label: () => `Execute #${proposal.id}`,
        receipt: executeScope(realmPath, caller, proposal.id),
        prepare: () => ({ msgs: [plan.msg] }),
        recheck: async () => {
            await withFeeCheck(stateCheck(), fee.assertStillCovers())
        },
        send: (_choice, beforeSign) => broadcastDaoTx(plan, memo, beforeSign, { fee: fee.fee }),
        // Proof on chain: this transaction ran without error and the proposal reads as executed.
        verify: async (_choice, hash) => {
            const [status, tx] = await Promise.all([
                readV2Proposal(v2Context(GNO_RPC_URL, realmPath), proposal.id).then((p) => p.status, () => null),
                verifySendTx(hash).catch(() => false as const),
            ])
            pendingNote = failedNote = undefined
            if (tx === "failed") {
                if (status === "EXECUTED") failedNote = `another member executed proposal #${proposal.id} first. Your transaction was refused and did not take effect; the network fee was still charged.`
                return "failed"
            }
            if (status === "EXECUTED" && tx === true) return true
            if (status === "EXECUTED") pendingNote = `Proposal #${proposal.id} reads as executed; this transaction isn't visible yet. Don't send it again.`
            return false
        },
        pendingNote: () => pendingNote,
        failedNote: () => failedNote,
    }
}
