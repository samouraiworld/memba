/**
 * Voting on and executing a weighted DAO proposal as Memba OS signing
 * requests. The call is built by the same planner as the classic page
 * (lib/dao/weighted), and the same checks (lib/dao/weightedActions) run again
 * right before the wallet opens, against the DAO the member reviewed: the
 * roster and roles unchanged, a seat, the proposal still votable or ready, a
 * changed ballot, the same action to execute. Receipts use their own scope,
 * so an unknown outcome locks the action until the member has checked it.
 *
 * @module os/daos/weightedRequest
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { governanceRequestActive } from "../../lib/dao/governanceRecovery"
import { formatUgnot, formatUgnotExact } from "../../lib/dao/v2Budget"
import { assertFeeStillCovers, FALLBACK_GAS_PRICE, feeForGasWanted, freshFeeForGasWanted, networkGasPriceFresh, type GasPrice } from "../../lib/grc20"
import { revealInvisibleFormatting as reveal } from "../../lib/dao/v2Text"
import {
    assertWeightedPlanSignable, planWeightedTx, readOpenWeightedProposals, readWeightedBallot, readWeightedProposal, weightedAuthority, weightedProposalTitle, weightedVoteChoices,
    WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedContext, type WeightedProposal, type WeightedSnapshot, type WeightedTxPlan,
} from "../../lib/dao/weighted"
import { proposalIdFromTxResult } from "../../lib/dao/daoTx"
import { broadcastWeightedPlan, checkWeightedAction, weightedAcceptLock, weightedTreasuryLock, weightedLocks, weightedMemo, weightedScope, weightedVoteLabel } from "../../lib/dao/weightedActions"
import { ACCEPTANCE_CONSEQUENCES, acceptAdapterFor } from "../../lib/dao/weightedAcceptance"
import { treasuryAdapterFor, type ApplicationPolicyKey, type TreasuryPolicyKey } from "../../lib/dao/weightedApplications"
import { teamWallet } from "../../lib/dao/weightedTreasury"
import { CURRENT_VERSION_ONLY, POLICY_LABELS, decisionRules, executionWarning, isVoteOpen, openProposalsOf, type BallotView } from "../../lib/dao/weightedView"
import { assertLiveWalletChain } from "../../lib/dao/weightedWallet"
import type { SignRequest } from "../sign/signer"
import { withFeeCheck } from "../sign/recheck"

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

export interface WeightedActContext {
    realmPath: string
    daoName: string
    /** The DAO as the member saw it: signing is refused if its roster, roles or config changed since. */
    snapshot: WeightedSnapshot
    caller: string
    /** The network gas price quoted when the member asked to act ({@link FALLBACK_GAS_PRICE} when it could not be read). */
    gasPrice: GasPrice
}

export interface WeightedRequestContext extends WeightedActContext {
    proposal: WeightedProposal
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
function requestParts<C extends string>(ctx: WeightedActContext, action: (choice: C | undefined) => WeightedAction, lock: {
    /**
     * Throws while an attempt's outcome is unknown: any receipt locks, except this attempt's own while its request runs in
     * this tab (the review re-prepares its messages then, for the wallet checklist).
     */
    assert: () => void
    /** Execute: the stored action that was reviewed. */
    executes?: WeightedProposal["action"]
}) {
    const { realmPath, snapshot, caller, gasPrice } = ctx
    const { schema } = snapshot.config
    if (schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error(CURRENT_VERSION_ONLY)
    const { executes } = lock
    // An earlier attempt with an unknown outcome stops a new one, whether or not the window showed the lock.
    lock.assert()
    const plan = (choice: C | undefined) => {
        const planned = planWeightedTx(caller, realmPath, action(choice), schema, GNO_CHAIN_ID, executes)
        assertWeightedPlanSignable(planned)
        return planned as WeightedTxPlan & { gasWanted: number; maxDepositUgnot: number }
    }
    // Every choice of one action has the same budget.
    const gasWanted = plan(undefined).gasWanted
    const gasFee = feeForGasWanted(gasWanted, gasPrice)
    return {
        // Called when the member signs, before this attempt's receipt is saved: any lock on the proposal, from any tab, stops it here.
        prepare: (choice: C | undefined) => { lock.assert(); return { msgs: [plan(choice).msg] } },
        lines: (choice: C | undefined): [string, string][] => [
            ["Storage deposit", `up to ${formatUgnot(plan(choice).maxDepositUgnot)}`],
            [gasPrice === FALLBACK_GAS_PRICE ? "Network fee (estimate: the price could not be read)" : "Network fee", formatUgnotExact(gasFee)],
            ["Gas limit", gasWanted.toLocaleString("en-US")],
            ["Network", GNO_CHAIN_ID],
        ],
        /** The classic page's checks against the reviewed DAO, then the wallet's chain; returns the fresh read. */
        check: async (choice: C | undefined) => {
            // By now this attempt's own receipt is saved and its request runs here: only another attempt's can still lock it.
            lock.assert()
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

/** The vote and execution locks of one proposal: either stops both. */
function proposalLock(ctx: WeightedRequestContext, operation: "vote" | "execute") {
    return {
        assert: () => {
            if (weightedLocks(GNO_CHAIN_ID, ctx.realmPath, ctx.caller, ctx.proposal.id).some((l) => l.operation !== operation || !governanceRequestActive(l.scope))) {
                throw new Error("An earlier attempt on this proposal has an unknown outcome. Check it in the proposal's window before acting again.")
            }
        },
        executes: operation === "execute" ? ctx.proposal.action : undefined,
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
    const parts = requestParts(ctx, action, proposalLock(ctx, "vote"))
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
        label: (choice) => weightedVoteLabel(choice ?? choices[0], proposal.id),
        receipt: weightedScope(GNO_CHAIN_ID, realmPath, caller, "vote", proposal.id),
        prepare: parts.prepare,
        recheck: async (choice) => { await withFeeCheck(parts.check(choice), parts.assertFee()) },
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
    const parts = requestParts(ctx, action, proposalLock(ctx, "execute"))
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
            await withFeeCheck(parts.check(undefined), parts.assertFee(), ({ snapshot: fresh }) => {
                const now = openProposalsOf(fresh.page)
                if (now.open.some((o) => o.id !== proposal.id && !otherOpen.includes(o.id)) || (complete && !now.complete)) {
                    throw new Error("More proposals are open than when you reviewed this execution. Review it again.")
                }
            })
        },
        send: parts.send,
        verify: async () => (await readWeightedProposal(contextOf(realmPath), proposal.id, snapshot.config.schema)).status === "EXECUTED",
    }
}

/**
 * A critical proposal that the DAO accepts an application it has been
 * nominated for. The recheck is the classic page's: the target still names the
 * DAO as pending and no other acceptance is open. Verified by the new
 * proposal on chain.
 */
export function weightedAcceptRequest(ctx: WeightedActContext, adapter: ApplicationPolicyKey): SignRequest {
    const { realmPath, snapshot, caller } = ctx
    const action = (): WeightedAction => ({ type: "accept", adapter })
    const parts = requestParts(ctx, action, {
        assert: () => {
            const earlier = weightedAcceptLock(GNO_CHAIN_ID, realmPath, caller)
            if (earlier && !governanceRequestActive(earlier.scope)) throw new Error("An earlier acceptance proposal has an unknown outcome. Check it before proposing again.")
        },
    })
    const label = POLICY_LABELS[adapter]
    const critical = decisionRules(snapshot.config)[0]
    return {
        title: "Propose",
        summary: `Propose that ${reveal(ctx.daoName)} accepts the handover of ${label}`,
        sub: snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? reveal(snapshot.config[adapter].target) : undefined,
        lines: () => [["Once it executes", ACCEPTANCE_CONSEQUENCES[adapter]], ["Passes with", critical.routes.join(", or ")], ...parts.lines(undefined)],
        warns: ["Memba offers one acceptance at a time, since executing any proposal invalidates the others: no other is offered here until this one executes or closes."],
        label: () => `Propose accepting ${label}`,
        receipt: weightedScope(GNO_CHAIN_ID, realmPath, caller, "accept", "handover"),
        prepare: parts.prepare,
        recheck: async () => { await withFeeCheck(parts.check(undefined), parts.assertFee()) },
        send: parts.send,
        // Proof on chain: an acceptance of this application proposed by this member (the one the wallet names, when it does).
        verify: async (_choice, _hash, result) => {
            const id = proposalIdFromTxResult(result)
            const ours = (p: WeightedProposal) => p.proposer === caller && acceptAdapterFor(p.action) === adapter
            if (id !== null) return ours(await readWeightedProposal(contextOf(realmPath), String(id), snapshot.config.schema))
            return (await readOpenWeightedProposals(contextOf(realmPath))).some(ours)
        },
    }
}

/**
 * A financial proposal that an application pays its fees to the treasury the
 * DAO's policy names. The recheck is the classic page's rule set: the DAO
 * controls it with no handover pending, today's treasury is set and differs, and none
 * is open for it. Verified by this member's open proposal on chain.
 */
export function weightedTreasuryRequest(ctx: WeightedActContext, adapter: TreasuryPolicyKey, paidToday: string): SignRequest {
    const { realmPath, snapshot, caller } = ctx
    if (snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error(CURRENT_VERSION_ONLY)
    const policy = snapshot.config[adapter]
    const action = (): WeightedAction => ({ type: "treasury", adapter })
    const parts = requestParts(ctx, action, {
        assert: () => {
            const earlier = weightedTreasuryLock(GNO_CHAIN_ID, realmPath, caller, adapter)
            if (earlier && !governanceRequestActive(earlier.scope)) throw new Error("An earlier proposal to move these fees has an unknown outcome. Check it before proposing again.")
        },
    })
    const label = POLICY_LABELS[adapter]
    const financial = decisionRules(snapshot.config).find((rule) => rule.category === "financial")!
    const named = teamWallet(policy.treasury)?.name
    return {
        title: "Propose",
        summary: `Propose that ${label} pays its fees to ${named ? `the ${named}` : policy.treasury}`,
        sub: reveal(policy.target),
        lines: () => [
            ["Paid today to", teamWallet(paidToday)?.name ?? paidToday],
            ["Would be paid to", `${named ? `${named} (${policy.treasury})` : policy.treasury}, the address the DAO's policy names`],
            ["Passes with", `${financial.routes.join(", or ")}, with no delay`],
            ...parts.lines(undefined),
        ],
        warns: ["Executing it, like any proposal, invalidates every other open proposal of this DAO."],
        label: () => `Propose moving ${label} fees`,
        receipt: weightedScope(GNO_CHAIN_ID, realmPath, caller, "treasury", adapter),
        prepare: parts.prepare,
        recheck: async () => { await withFeeCheck(parts.check(undefined), parts.assertFee()) },
        send: parts.send,
        // Proof on chain: a proposal of this member moving this application's fees (the one the wallet names, when it does).
        verify: async (_choice, _hash, result) => {
            const id = proposalIdFromTxResult(result)
            const ours = (p: WeightedProposal) => p.proposer === caller && treasuryAdapterFor(p.action) === adapter
            if (id !== null) return ours(await readWeightedProposal(contextOf(realmPath), String(id), snapshot.config.schema))
            return (await readOpenWeightedProposals(contextOf(realmPath))).some(ours)
        },
    }
}
