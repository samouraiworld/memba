/**
 * The checks a weighted DAO action must pass against fresh chain state, shared
 * by the classic page (pages/WeightedDAO) and the Memba OS signing
 * requests (os/daos/weightedRequest). They run before an action is offered for
 * confirmation and again right before the wallet opens. A read cannot rule out
 * a later on-chain race: the realm stays the final judge.
 */
import { doContractBroadcast } from "../grc20"
import { readGovernanceReceipt, type GovernanceReceipt, type GovernanceScope } from "./governanceRecovery"
import { revealInvisibleFormatting as reveal } from "./v2Text"
import {
    readOpenWeightedProposals, readWeightedBallot, readWeightedProposal, readWeightedSnapshot, validateWeightedRecovery, weightedAuthority,
    WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedContext, type WeightedProposal, type WeightedSnapshot, type WeightedTxPlan,
} from "./weighted"
import { ACCEPTANCE_LABELS, AUTHORITY_GETTERS, acceptanceState, readTargetAuthority, weightedDaoAddress } from "./weightedAcceptance"
import { acceptAdapterFor, treasuryAdapterFor, type ApplicationPolicyKey, type TreasuryPolicyKey } from "./weightedApplications"
import { readFeeDestinations } from "./weightedTreasury"
import { POLICY_LABELS, isVoteOpen, type BallotView } from "./weightedView"

export interface WeightedActionCheck {
    ctx: WeightedContext
    caller: string
    action: WeightedAction
    /**
     * When the check runs: "review" before the action is shown for
     * confirmation, "sign" right before the wallet opens. Only the wording of
     * a change differs.
     */
    phase: "review" | "sign"
    /** weightedAuthority of the roster, roles and config the member last saw; null when nothing was shown yet. */
    reviewed: string | null
    /** Execute, at signing: the stored action that was reviewed, which the proposal must still hold. */
    executes?: WeightedProposal["action"]
    /** The caller's own "nothing moved" check (page, wallet, session); it runs after every read. */
    assertCurrent: () => void
}

export interface WeightedActionChecked {
    snapshot: WeightedSnapshot
    /** Vote and execute: the action the proposal holds now (what an Execute would run). */
    executes?: WeightedProposal["action"]
}

/** The target must still name the DAO as its pending authority, and no other acceptance may be open anywhere in the history (whichever executes first voids the rest). */
async function assertAcceptable({ ctx, assertCurrent }: WeightedActionCheck, snapshot: WeightedSnapshot, adapter: ApplicationPolicyKey) {
    if (snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error("This DAO has no application adapters")
    const policy = snapshot.config[adapter]
    const open = (await readOpenWeightedProposals(ctx)).find(p => acceptAdapterFor(p.action) !== null)
    assertCurrent()
    if (open) throw new Error(`Acceptance proposal #${open.id} is still open; propose the next acceptance after it executes or closes`)
    const state = acceptanceState(await readTargetAuthority(ctx, adapter, policy.target, policy.successor), weightedDaoAddress(ctx.realmPath))
    assertCurrent()
    if (state.kind !== "ready") throw new Error(`${reveal(policy.target)} is not ready for the DAO to accept (${ACCEPTANCE_LABELS[state.kind].toLowerCase()}); refresh before acting`)
}

/**
 * The host takes a treasury proposal only while the DAO controls the
 * application with no handover pending, and only to the policy's treasury
 * when today's is set and differs; Memba offers one open per application.
 */
async function assertTreasuryProposable({ ctx, assertCurrent }: WeightedActionCheck, snapshot: WeightedSnapshot, adapter: TreasuryPolicyKey) {
    if (snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) throw new Error("This DAO has no application adapters")
    const policy = snapshot.config[adapter]
    const label = POLICY_LABELS[adapter]
    const state = acceptanceState(await readTargetAuthority(ctx, adapter, policy.target, policy.successor), weightedDaoAddress(ctx.realmPath))
    assertCurrent()
    if (state.kind !== "dao") throw new Error(`The DAO does not control ${label} yet, so it cannot move its fees`)
    if (state.pending) throw new Error(`A handover of ${label} back to its publisher is pending; its fees cannot move until that is settled`)
    const current = (await readFeeDestinations(ctx, snapshot.config)).find(d => d.key === adapter)?.current
    assertCurrent()
    if (current === null || current === undefined) throw new Error(`${label}'s treasury could not be read; refresh before acting`)
    if (current === "") throw new Error(`${label} has no treasury set; the DAO can move its fees only once one is set`)
    if (current === policy.treasury) throw new Error(`${label} already pays its fees to the address the DAO's policy names`)
    const open = (await readOpenWeightedProposals(ctx)).find(p => treasuryAdapterFor(p.action) === adapter)
    assertCurrent()
    if (open) throw new Error(`Proposal #${open.id} to move ${label}'s fees is still open`)
}

/** The host refuses an acceptance whose frozen nomination no longer holds. */
async function assertHandoffStillNominated({ ctx, assertCurrent }: WeightedActionCheck, snapshot: WeightedSnapshot, executes: WeightedProposal["action"]) {
    const handoff = snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? acceptAdapterFor(executes) : null
    if (!handoff || snapshot.config.schema !== WEIGHTED_APPLICATIONS_SCHEMA) return
    const policy = snapshot.config[handoff]
    const state = acceptanceState(await readTargetAuthority(ctx, handoff, policy.target, policy.successor), weightedDaoAddress(ctx.realmPath))
    assertCurrent()
    const role = AUTHORITY_GETTERS[handoff].authority, target = reveal(policy.target)
    if (state.kind === "dao") throw new Error(`The DAO already controls ${target}, so this acceptance would fail; refresh before acting`)
    if (state.kind === "blocked") throw new Error(`${target} would refuse this acceptance: ${state.reasons.join(" ")}`)
    if (state.kind === "awaiting") throw new Error(`${target} no longer names the DAO as its pending ${role} (pending: ${reveal(state.pending || "none")}), so this acceptance would fail; refresh before acting`)
}

/** The receipt of a vote, an execution or an acceptance proposal signed in Memba OS, kept while its outcome is unknown. */
export function weightedScope(chainId: string, realmPath: string, caller: string, operation: "vote" | "execute" | "accept" | "treasury", id: string): GovernanceScope {
    return { chainId, realmPath, caller, operation: `weighted-${operation}:${id}` }
}

/**
 * The receipts that lock acting on proposal `id`: while either outcome is
 * unknown, neither a vote nor an execution is offered on it, in the proposal
 * window or on the classic page.
 */
export function weightedLocks(chainId: string, realmPath: string, caller: string, id: string) {
    return (["vote", "execute"] as const).map((operation) => ({ operation, scope: weightedScope(chainId, realmPath, caller, operation, id) }))
        .map((lock) => ({ ...lock, receipt: readGovernanceReceipt(lock.scope) }))
        .filter((lock) => lock.receipt !== null)
}

/** A vote's label in the review, the tray and its receipt; the receipt's label is how a later read knows which choice was tried. */
export function weightedVoteLabel(choice: "Yes" | "No" | "Abstain", id: string): string {
    return `Vote ${choice} on #${id}`
}
const TRIED_VOTE = /^Vote (Yes|No|Abstain) on #\d+$/

/**
 * A vote lock the chain has made moot, so a later read in the proposal
 * window clears it: voting is over, or the ballot shows the choice that was
 * tried. An execution lock stays until the member says they checked the
 * transaction (while the proposal is open, nothing read says whether the
 * attempt ran).
 */
export function weightedLockSettled(lock: { operation: "vote" | "execute"; receipt: GovernanceReceipt | null }, p: Pick<WeightedProposal, "status" | "votingClosed">, ballot: BallotView): boolean {
    if (lock.operation === "execute") return false
    if (!isVoteOpen(p)) return true
    const tried = lock.receipt ? TRIED_VOTE.exec(lock.receipt.label)?.[1] : undefined
    return !!tried && !!ballot && ballot !== "error" && ballot.choice === tried.toLowerCase()
}

/**
 * The receipt of an acceptance proposal signed in Memba OS. One lock for the
 * whole DAO: only one acceptance may be open at a time, so while an attempt's
 * outcome is unknown no other is offered.
 */
export function weightedAcceptLock(chainId: string, realmPath: string, caller: string) {
    const scope = weightedScope(chainId, realmPath, caller, "accept", "handover")
    const receipt = readGovernanceReceipt(scope)
    return receipt ? { scope, receipt } : null
}

/** The receipt of a treasury proposal for one application signed in Memba OS: while its outcome is unknown, no other is offered for it. */
export function weightedTreasuryLock(chainId: string, realmPath: string, caller: string, adapter: TreasuryPolicyKey) {
    const scope = weightedScope(chainId, realmPath, caller, "treasury", adapter)
    const receipt = readGovernanceReceipt(scope)
    return receipt ? { scope, receipt } : null
}

/**
 * Why an action is locked by a Memba OS attempt whose outcome is unknown, or
 * null. The classic page refuses what this names; it writes no receipt itself.
 */
export function weightedActionLock(chainId: string, realmPath: string, caller: string, action: WeightedAction): string | null {
    if ((action.type === "vote" || action.type === "execute") && weightedLocks(chainId, realmPath, caller, action.id).length) {
        return `An earlier attempt on proposal #${action.id} has an unknown outcome; check it in the proposal's Memba OS window before trying again`
    }
    if (action.type === "accept" && weightedAcceptLock(chainId, realmPath, caller)) {
        return "An earlier acceptance proposal has an unknown outcome; check it in the DAO's Memba OS window before proposing again"
    }
    return null
}

export async function checkWeightedAction(check: WeightedActionCheck): Promise<WeightedActionChecked> {
    const { ctx, caller, action, phase, reviewed, assertCurrent } = check
    const signing = phase === "sign"
    assertCurrent()
    const snapshot = await readWeightedSnapshot(ctx)
    assertCurrent()
    if (reviewed !== null && weightedAuthority(snapshot) !== reviewed) throw new Error(signing ? "DAO roster or roles changed during confirmation; review again" : "DAO roster or roles changed; refresh and review again")
    if (!snapshot.members.some(m => m.address === caller)) throw new Error("Only current DAO members can act")
    if (action.type === "recover") { validateWeightedRecovery(snapshot, action); return { snapshot } }
    if (action.type === "propose") {
        const subject = snapshot.members.find(m => m.address === action.target)
        if (!subject || subject[action.role] === action.grant) throw new Error("Select a role change for a current member")
        if (action.role === "admin" && !action.grant && snapshot.members.filter(m => m.admin).length === 1) throw new Error("Grant a replacement admin before removing the last admin")
        return { snapshot }
    }
    if (action.type === "accept") { await assertAcceptable(check, snapshot, action.adapter); return { snapshot } }
    if (action.type === "treasury") { await assertTreasuryProposable(check, snapshot, action.adapter); return { snapshot } }
    const changed = signing ? "Proposal changed during confirmation; refresh" : "Proposal state changed; refresh before acting"
    const proposal = await readWeightedProposal(ctx, action.id, snapshot.config.schema)
    assertCurrent()
    if (action.type === "execute" ? !proposal.ready : !isVoteOpen(proposal)) throw new Error(changed)
    if (action.type === "execute" && check.executes && JSON.stringify(proposal.action) !== JSON.stringify(check.executes)) throw new Error(changed)
    if (action.type === "vote" && snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA) {
        // A ballot is valid only for an eligible voter and a changed choice.
        const ballot = await readWeightedBallot(ctx, action.id, caller)
        assertCurrent()
        if (!ballot.eligible) throw new Error("Your address is not eligible to vote on this proposal")
        if (ballot.choice === action.vote) throw new Error(`You already voted ${action.vote}; the same ballot again would change nothing`)
    }
    if (action.type === "execute") await assertHandoffStillNominated(check, snapshot, proposal.action)
    return { snapshot, executes: proposal.action }
}

/** The transaction memo of an action, as the wallet shows it. */
export function weightedMemo(action: WeightedAction, snapshot: WeightedSnapshot): string {
    if (action.type === "recover") return `Recover ${reveal(action.personId)}: ${action.oldAddress} → ${action.newAddress}. Preserve voting weight and roles.`
    if (action.type === "propose") return `Propose ${action.grant ? "grant" : "removal"} of ${action.role}: ${action.target}`
    if (action.type === "accept") return `Propose that the DAO accepts authority over ${snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? snapshot.config[action.adapter].target : ""}`
    if (action.type === "treasury") return snapshot.config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? `Propose that ${snapshot.config[action.adapter].target} pays its fees to ${snapshot.config[action.adapter].treasury}` : ""
    return action.type === "vote" ? `vote ${action.vote} on weighted proposal ${action.id}` : `execute weighted proposal ${action.id}`
}

/**
 * Send exactly the planned call, once: no automatic retry, since a second
 * attempt after an unclear outcome could act twice. `beforeSign` runs the
 * fresh checks right before the wallet opens; `gasFee` is the fee the member
 * reviewed, when one was shown. A reply without a transaction hash is an
 * error, never a success.
 */
export async function broadcastWeightedPlan(plan: WeightedTxPlan, memo: string, beforeSign: () => Promise<void | (() => boolean)>, gasFee?: number) {
    const result = await doContractBroadcast([plan.msg], memo, { beforeSign, ...(plan.gasWanted !== undefined ? { gasWanted: plan.gasWanted } : {}), ...(gasFee !== undefined ? { gasFee } : {}) })
    if (!/^[a-f0-9]{64}$/i.test(result.hash)) throw new Error("Wallet returned no valid transaction hash; check chain state before trying again")
    return result
}
