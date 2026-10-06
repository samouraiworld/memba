/**
 * The checks a weighted DAO action must pass against fresh chain state on the
 * classic page (pages/WeightedDAO). They run before an action is offered for
 * confirmation and again right before the wallet opens. A read cannot rule out
 * a later on-chain race: the realm stays the final judge.
 */
import { doContractBroadcast } from "../grc20"
import type { AminoMsg } from "./shared"
import { revealInvisibleFormatting as reveal } from "./v2Text"
import {
    readWeightedProposal, readWeightedSnapshot, validateWeightedRecovery, weightedAuthority,
    type WeightedAction, type WeightedContext, type WeightedProposal, type WeightedSnapshot,
} from "./weighted"
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
    const changed = signing ? "Proposal changed during confirmation; refresh" : "Proposal state changed; refresh before acting"
    const proposal = await readWeightedProposal(ctx, action.id, snapshot.config.schema)
    assertCurrent()
    if (action.type === "execute" ? !proposal.ready : !isVoteOpen(proposal)) throw new Error(changed)
    if (action.type === "execute" && check.executes && JSON.stringify(proposal.action) !== JSON.stringify(check.executes)) throw new Error(changed)
    return { snapshot, executes: proposal.action }
}

/** The transaction memo of an action, as the wallet shows it. */
export function weightedMemo(action: WeightedAction): string {
    if (action.type === "recover") return `Recover ${reveal(action.personId)}: ${action.oldAddress} → ${action.newAddress}. Preserve voting weight and roles.`
    if (action.type === "propose") return `Propose ${action.grant ? "grant" : "removal"} of ${action.role}: ${action.target}`
    return action.type === "vote" ? `vote ${action.vote} on weighted proposal ${action.id}` : `execute weighted proposal ${action.id}`
}

/**
 * Send exactly the built call, once: no automatic retry, since a second
 * attempt after an unclear outcome could act twice. `beforeSign` runs the
 * fresh checks right before the wallet opens. A reply without a transaction
 * hash is an error, never a success.
 */
export async function broadcastWeightedMessage(msg: AminoMsg, memo: string, beforeSign: () => Promise<void | (() => boolean)>) {
    const result = await doContractBroadcast([msg], memo, { beforeSign })
    if (!/^[a-f0-9]{64}$/i.test(result.hash)) throw new Error("Wallet returned no valid transaction hash; check chain state before trying again")
    return result
}
