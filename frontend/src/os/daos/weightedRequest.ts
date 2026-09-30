/**
 * Voting on and executing a weighted DAO proposal as Memba OS signing
 * requests. The call is built by the same planner as the classic workspace
 * (lib/dao/weighted), and the same checks (lib/dao/weightedActions) run again
 * right before the wallet opens, against the DAO the member reviewed: the
 * roster and roles unchanged, a seat, the proposal still votable or ready, a
 * changed ballot, the same action to execute. Receipts use their own scope,
 * so an unknown outcome locks the action until the member has checked it.
 *
 * @module os/daos/weightedRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { formatUgnot, formatUgnotExact } from "../../lib/dao/v2Budget"
import { assertFeeStillCovers, FALLBACK_GAS_PRICE, feeForGasWanted, freshFeeForGasWanted, networkGasPriceFresh, type GasPrice } from "../../lib/grc20"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import {
    assertWeightedPlanSignable, planWeightedTx, readWeightedBallot, readWeightedProposal, weightedAuthority, weightedProposalTitle, weightedVoteChoices,
    WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedContext, type WeightedProposal, type WeightedSnapshot, type WeightedTxPlan,
} from "../../lib/dao/weighted"
import { broadcastWeightedPlan, checkWeightedAction, weightedMemo, weightedScope } from "../../lib/dao/weightedActions"
import { executionWarning, isVoteOpen, openProposalsOf, type BallotView } from "../../lib/dao/weightedView"
import { assertLiveWalletChain } from "../../lib/dao/weightedWallet"
import type { SignRequest } from "../sign/signer"

const WEIGHTED_VOTE_OPTIONS = ["Yes", "No", "Abstain"] as const
export type WeightedVoteOption = (typeof WEIGHTED_VOTE_OPTIONS)[number]
const BALLOT: Record<WeightedVoteOption, "yes" | "no" | "abstain"> = { Yes: "yes", No: "no", Abstain: "abstain" }

/**
 * The options the contract would record for this voter now, only on the
 * application version (the one that publishes ballots, so a vote can be
 * verified): none once voting is over, only an eligible voter's changed
 * choice, null while their ballot is still being read.
 */
export function weightedVoteOptions(p: WeightedProposal, schema: string, ballot: BallotView): WeightedVoteOption[] | null {
    if (!isVoteOpen(p) || schema !== WEIGHTED_APPLICATIONS_SCHEMA) return []
    if (ballot === undefined) return null
    const allowed = weightedVoteChoices(p, ballot)
    return WEIGHTED_VOTE_OPTIONS.filter((option) => allowed.has(BALLOT[option]))
}

export interface WeightedRequestContext {
    realmPath: string
    daoName: string
    /** The DAO as the member saw it: signing is refused if its roster, roles or config changed since. */
    snapshot: WeightedSnapshot
    proposal: WeightedProposal
    caller: string
    /** The network gas price quoted when the member asked to act ({@link FALLBACK_GAS_PRICE} when it could not be read). */
    gasPrice: GasPrice
}

/** The network gas price for a review: a fresh read, or the fallback, which the review then calls an estimate. */
export async function quoteWeightedGasPrice(): Promise<GasPrice> {
    return networkGasPriceFresh().catch(() => FALLBACK_GAS_PRICE)
}

const contextOf = (realmPath: string): WeightedContext => ({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, realmPath })

/**
 * The shared pieces of both requests. Only the application version is signed
 * here: its calls have measured budgets and its results can be verified. The
 * fee is fixed at the review from the quoted price and the measured gas, shown
 * exactly, re-checked against a fresh quote before the wallet opens, and sent
 * as reviewed.
 */
function requestParts<C extends string>(ctx: WeightedRequestContext, action: (choice: C | undefined) => WeightedAction) {
    const { realmPath, snapshot, proposal, caller, gasPrice } = ctx
    const { schema } = snapshot.config
    if (schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error("This DAO version is acted on in its workspace")
    const executes = action(undefined).type === "execute" ? proposal.action : undefined
    const plan = (choice: C | undefined) => {
        const planned = planWeightedTx(caller, realmPath, action(choice), schema, GNO_CHAIN_ID, executes)
        assertWeightedPlanSignable(planned)
        return planned as WeightedTxPlan & { gasWanted: number; maxDepositUgnot: number }
    }
    // Every choice of one action has the same budget.
    const gasWanted = plan(undefined).gasWanted
    const gasFee = feeForGasWanted(gasWanted, gasPrice)
    return {
        prepare: (choice: C | undefined) => ({ msgs: [plan(choice).msg] }),
        lines: (choice: C | undefined): [string, string][] => [
            ["Storage deposit", `up to ${formatUgnot(plan(choice).maxDepositUgnot)}`],
            [gasPrice === FALLBACK_GAS_PRICE ? "Network fee (estimate: the price could not be read)" : "Network fee", formatUgnotExact(gasFee)],
            ["Gas limit", gasWanted.toLocaleString("en-US")],
            ["Network", GNO_CHAIN_ID],
        ],
        /** The workspace's checks against the reviewed DAO, then the wallet's chain; returns the fresh read. */
        check: async (choice: C | undefined) => {
            // The network, the RPC and the planner's write rules are fixed for the page; the session is checked by the signer.
            const checked = await checkWeightedAction({ ctx: contextOf(realmPath), caller, action: action(choice), phase: "sign", reviewed: weightedAuthority(snapshot), executes, assertCurrent: () => {} })
            await assertLiveWalletChain({ chainId: GNO_CHAIN_ID, address: caller, schema, realmPath })
            return checked
        },
        assertFee: () => assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(gasWanted)),
        send: (choice: C | undefined, beforeSign: () => Promise<void | (() => boolean)>) =>
            broadcastWeightedPlan(plan(choice), weightedMemo(action(choice), snapshot), beforeSign, gasFee),
    }
}

/**
 * A ballot on an open proposal of the application version. `choices` are
 * the ones the contract would record (it refuses the ballot already cast).
 */
export function weightedVoteRequest(ctx: WeightedRequestContext, choices: readonly WeightedVoteOption[]): SignRequest<WeightedVoteOption> {
    const { realmPath, snapshot, proposal, caller } = ctx
    if (!choices.length) throw new Error("No vote is open to you on this proposal")
    const action = (choice: WeightedVoteOption | undefined): WeightedAction => ({ type: "vote", id: proposal.id, vote: BALLOT[choice ?? choices[0]] })
    const parts = requestParts(ctx, action)
    const seat = snapshot.members.find((m) => m.address === caller)
    return {
        title: "Vote",
        summary: `Vote on #${proposal.id} “${reveal(weightedProposalTitle(proposal))}”`,
        sub: reveal(ctx.daoName),
        choice: { label: "Your vote", options: choices, initial: choices[0] },
        lines: (choice) => [
            ["Your vote", choice ?? choices[0]],
            ...(seat ? [["Your voting points", `${seat.weight} of ${snapshot.config.totalPoints}`] as [string, string]] : []),
            ...parts.lines(choice),
        ],
        note: "You can change your vote until voting closes, unless the proposal is executed or invalidated first.",
        label: (choice) => `Vote ${choice ?? choices[0]} on #${proposal.id}`,
        receipt: weightedScope(GNO_CHAIN_ID, realmPath, caller, "vote", proposal.id),
        prepare: parts.prepare,
        recheck: async (choice) => { await parts.check(choice); await parts.assertFee() },
        send: parts.send,
        verify: async (choice) => (await readWeightedBallot(contextOf(realmPath), proposal.id, caller)).choice === BALLOT[choice ?? choices[0]],
    }
}

/**
 * Executing a ready proposal. It invalidates every other open proposal: the
 * member acknowledges which, as far as they were read (`complete` is false
 * when older proposals were not), and signing is refused if more are open
 * by then.
 */
export function weightedExecuteRequest(ctx: WeightedRequestContext, otherOpen: readonly string[], complete: boolean): SignRequest {
    const { realmPath, snapshot, proposal, caller } = ctx
    const action = (): WeightedAction => ({ type: "execute", id: proposal.id })
    const parts = requestParts(ctx, action)
    return {
        title: "Execute",
        summary: `Execute #${proposal.id} “${reveal(weightedProposalTitle(proposal))}”`,
        sub: reveal(ctx.daoName),
        lines: () => parts.lines(undefined),
        warns: [executionWarning(proposal.id, otherOpen, complete)],
        acks: [`I understand that executing #${proposal.id} invalidates every other open proposal of this DAO.`],
        label: () => `Execute #${proposal.id}`,
        receipt: weightedScope(GNO_CHAIN_ID, realmPath, caller, "execute", proposal.id),
        prepare: parts.prepare,
        recheck: async () => {
            const { snapshot: fresh } = await parts.check(undefined)
            const now = openProposalsOf(fresh.page)
            if (now.open.some((o) => o.id !== proposal.id && !otherOpen.includes(o.id)) || (complete && !now.complete)) {
                throw new Error("More proposals are open than when you reviewed this execution. Review it again.")
            }
            await parts.assertFee()
        },
        send: parts.send,
        verify: async () => (await readWeightedProposal(contextOf(realmPath), proposal.id, snapshot.config.schema)).status === "EXECUTED",
    }
}
