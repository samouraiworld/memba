/**
 * memba_gov and bridge calls as transaction plans: the exact message, a gas
 * limit and a storage-deposit cap, so what a member reviews is what signs.
 */
import type { DaoTxPlan } from "./daoTx"
import { encodeArgs, validText, type DaoauthField } from "./daoauth"
import type { GovDraft } from "./govDrafts"
import { BRIDGE_APPS, BRIDGE_PATH, GOV_PATH, bridgeCall } from "./govActions"
import type { GovApproval, GovProposal } from "./membaGov"
import { address, id } from "./weightedPrimitives"

/**
 * Gas measured on the node fixtures with three seats: Vote 9.9M, Join 7.3M,
 * bridge calls 6.5M to 22.2M; with 25 seats, a vote that qualifies a proposal
 * and reads its status used 16.5M. Each limit leaves room for a full roster
 * and the longest text. Deposits are 100 ugnot a byte; the largest write
 * seen, a new channel, stored 8,440 bytes.
 */
export const GOV_BUDGETS = {
    vote: { gasWanted: 30_000_000, maxDepositUgnot: 500_000 },
    join: { gasWanted: 30_000_000, maxDepositUgnot: 500_000 },
    // A roster Execute with 25 seats used about 20.1M (unit-test measure: the core's checkRoster walks them all).
    execute: { gasWanted: 40_000_000, maxDepositUgnot: 1_000_000 },
    bridge: { gasWanted: 50_000_000, maxDepositUgnot: 2_000_000 },
    pause: { gasWanted: 30_000_000, maxDepositUgnot: 500_000 },
    // A Propose with a 256-character target used 55.6M gas (AVL rebalance) and stored about 3.7 KB.
    propose: { gasWanted: 80_000_000, maxDepositUgnot: 1_000_000 },
} as const

export type GovVote = "yes" | "no" | "abstain"
export type GovCall =
    | { type: "vote"; id: string; vote: GovVote }
    | { type: "execute"; proposal: GovProposal }
    | { type: "join" }
    | { type: "pause" | "expire-pause"; app: string }
    | { type: "propose"; draft: GovDraft }

const argText = (f: DaoauthField) => (f.tag === "b" ? (f.value === "1" ? "true" : "false") : f.value)

/** The bridge call that executes an app proposal; throws when Memba cannot build it. */
export function bridgeExecution(p: GovProposal) {
    const call = p.target === BRIDGE_PATH ? bridgeCall(p.action, p.args) : null
    if (!call) throw new Error("Memba cannot execute this action: its target realm consumes the approval itself.")
    return { func: call.func, args: [p.id, ...call.params.map(argText)], approval: encodeArgs([{ tag: "s", value: call.func }, ...call.params]) }
}

/** Whether the bridge, asked now, would consume exactly this proposal: the app's state still matches the vote. */
export const approvalMatches = (p: GovProposal, a: GovApproval) => a.action === p.action && a.args === p.args && a.scope === p.scope && p.class >= a.class

export function planGovCall(caller: string, call: GovCall): DaoTxPlan {
    address.parse(caller)
    let pkg = GOV_PATH, func: string, args: string[], budget: { gasWanted: number; maxDepositUgnot: number }
    switch (call.type) {
        case "vote": func = "Vote"; args = [id.parse(call.id), call.vote]; budget = GOV_BUDGETS.vote; break
        case "join": func = "Join"; args = []; budget = GOV_BUDGETS.join; break
        case "propose": {
            const d = call.draft
            if (!validText(d.note) || d.note.length > 280) throw new Error("A note is at most 280 printable ASCII characters")
            func = "Propose"; args = [d.target, d.action, d.args, d.scope, String(d.class), d.note]; budget = GOV_BUDGETS.propose; break
        }
        case "execute":
            if (call.proposal.target === GOV_PATH) { func = "Execute"; args = [id.parse(call.proposal.id)]; budget = GOV_BUDGETS.execute; break }
            ({ func, args } = bridgeExecution(call.proposal)); pkg = BRIDGE_PATH; budget = GOV_BUDGETS.bridge; break
        default:
            if (!BRIDGE_APPS[call.app]?.pause) throw new Error("This app has no pause")
            pkg = BRIDGE_PATH; func = call.type === "pause" ? "EmergencyPause" : "ExpirePause"; args = [call.app]; budget = GOV_BUDGETS.pause
    }
    return {
        msg: { type: "vm/MsgCall", value: { caller, send: "", pkg_path: pkg, func, args, max_deposit: `${budget.maxDepositUgnot}ugnot` } },
        gasWanted: budget.gasWanted, maxDepositUgnot: budget.maxDepositUgnot,
    }
}
