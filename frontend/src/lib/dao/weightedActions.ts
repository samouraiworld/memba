/**
 * The checks a weighted DAO action must pass against fresh chain state, shared
 * by the classic workspace (pages/WeightedDAO) and the Memba OS signing
 * requests (os/daos/weightedRequest). They run before an action is offered for
 * confirmation and again right before the wallet opens. A read cannot rule out
 * a later on-chain race: the realm stays the final judge.
 */
import { doContractBroadcast } from "../grc20"
import { readGovernanceReceipt, type GovernanceScope } from "./governanceRecovery"
import { revealInvisibleFormatting as reveal } from "./v2Text"
import {
    readOpenWeightedProposals, readWeightedBallot, readWeightedProposal, readWeightedSnapshot, validateWeightedRecovery, weightedAuthority,
    WEIGHTED_APPLICATIONS_SCHEMA, type WeightedAction, type WeightedContext, type WeightedProposal, type WeightedSnapshot, type WeightedTxPlan,
} from "./weighted"
import { ACCEPTANCE_LABELS, AUTHORITY_GETTERS, acceptanceState, readTargetAuthority, weightedDaoAddress } from "./weightedAcceptance"
import { acceptAdapterFor, type ApplicationPolicyKey } from "./weightedApplications"
import { isVoteOpen } from "./weightedView"

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

/** The receipt of a vote or an execution signed in Memba OS, kept while its outcome is unknown. */
export function weightedScope(chainId: string, realmPath: string, caller: string, operation: "vote" | "execute", id: string): GovernanceScope {
    return { chainId, realmPath, caller, operation: `weighted-${operation}:${id}` }
}

/**
 * The receipts that lock acting on proposal `id`: while either outcome is
 * unknown, neither a vote nor an execution is offered on it, in the proposal
 * window or in the workspace.
 */
export function weightedLocks(chainId: string, realmPath: string, caller: string, id: string) {
    return (["vote", "execute"] as const).map((operation) => ({ operation, scope: weightedScope(chainId, realmPath, caller, operation, id) }))
        .map((lock) => ({ ...lock, receipt: readGovernanceReceipt(lock.scope) }))
        .filter((lock) => lock.receipt !== null)
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
