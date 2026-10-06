/**
 * Resolving a GovDAO proposal on gno.land (r/gov/dao, implementation v0) as a
 * signing request. GovDAO has no "passed" state: a proposal stays open until
 * someone calls ExecuteOrRejectProposal. Any account may, once YES reaches the
 * law's supermajority (the proposal's action then runs with GovDAO's
 * authority) or NO does (the proposal is denied and its action never runs);
 * before that the call is refused. When the action itself fails, GovDAO marks
 * the proposal denied with the error as its reason, and the transaction still
 * succeeds.
 *
 * The tallies are the contract's own (YesPercent / NoPercent, printed in full
 * in the proposal page's Stats section) and the supermajority is its law, read
 * live; both are read again right before the wallet opens. The transaction
 * carries a measured gas limit and storage-deposit cap (GOVDAO_BUDGETS).
 *
 * @module os/daos/govdaoExecute
 */
import { GNO_CHAIN_ID, GNO_RPC_URL } from "../../lib/config"
import { queryEval, queryRender } from "../../lib/dao/shared"
import { broadcastDaoTx, GOVDAO_BUDGETS, planDaoTx } from "../../lib/dao/daoTx"
import { formatUgnot } from "../../lib/dao/v2Budget"
import { revealInvisibleFormatting } from "../../lib/dao/v2Text"
import type { GasPrice } from "../../lib/grc20"
import type { SignRequest } from "../sign/signer"
import { withFeeCheck } from "../sign/recheck"
import { verifySendTx } from "../wallet/sendRequest"
import { executeScope } from "./executeRequest"
import { sheetFee } from "./sheetFee"

export const GOVDAO_REALM = "gno.land/r/gov/dao"
/** The implementation whose rules this module encodes (PreExecuteProposal, law, Stats render). */
const GOVDAO_IMPL = "gno.land/r/gov/dao/impl/v0"

export interface GovDaoTally {
    state: "open" | "accepted" | "denied"
    /** Why GovDAO denied it, as the chain states it (denied only; null when it gave none). */
    reason: string | null
    /** Shares of GovDAO's voting power, weighted by tier, in percent. */
    yes: number
    no: number
    abstain: number
}

/**
 * The realm-generated Stats section of a GovDAO proposal page, or null when the
 * page doesn't have that exact shape. Read from the LAST "### Stats" heading:
 * the description and the action's text, written by the proposer, come before it.
 */
export function parseGovDaoStats(page: string): GovDaoTally | null {
    const headings = [...page.matchAll(/^### Stats[ \t]*$/gm)]
    const last = headings.at(-1)
    if (last?.index === undefined) return null
    const lines = page.slice(last.index).split("\n").slice(1).filter((l) => l.trim() !== "")
    const head = lines[0]?.trim()
    const state = head === "- **Proposal is open for votes**" ? "open"
        : head === "- **PROPOSAL HAS BEEN ACCEPTED**" ? "accepted"
            : head === "- **PROPOSAL HAS BEEN DENIED**" ? "denied" : null
    if (!state) return null
    const reasonLine = state === "denied" && lines[1]?.startsWith("REASON: ") ? lines[1] : null
    const percent = (label: "YES" | "NO" | "ABSTAIN") => {
        const line = lines.find((l) => l.startsWith(`- ${label} PERCENT: `))
        const m = line && /^- (?:YES|NO|ABSTAIN) PERCENT: ([0-9.eE+-]+)%$/.exec(line.trim())
        const v = m ? Number(m[1]) : NaN
        return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null
    }
    const yes = percent("YES")
    const no = percent("NO")
    const abstain = percent("ABSTAIN")
    if (yes === null || no === null || abstain === null) return null
    return { state, reason: reasonLine ? reasonLine.slice("REASON: ".length).trim() : null, yes, no, abstain }
}

/** A proposal's tally from the chain, or null when its page isn't this GovDAO's shape (throws when it can't be read). */
export async function readGovDaoTally(id: number): Promise<GovDaoTally | null> {
    const page = await queryRender(GNO_RPC_URL, GOVDAO_REALM, String(id), true)
    return page ? parseGovDaoStats(page) : null
}

/** GovDAO's law in percent, from the chain, only while its implementation is the one whose rules this module encodes. */
export async function readGovDaoSupermajority(): Promise<number> {
    const [active, allowed, law] = await Promise.all([
        queryEval(GNO_RPC_URL, GOVDAO_REALM, "dao", true),
        queryEval(GNO_RPC_URL, GOVDAO_REALM, "AllowedDAOs()", true),
        queryEval(GNO_RPC_URL, GOVDAO_IMPL, "law.Supermajority", true),
    ])
    // The proxy's active implementation, and the only one it could be switched to.
    if (!active?.trim().endsWith(` *${GOVDAO_IMPL}.GovDAO)`) || allowed !== `(slice[("${GOVDAO_IMPL}" string)] []string)`) throw new Error("GovDAO's implementation isn't the one Memba knows, so Memba can't resolve its proposals.")
    const m = law ? /^\((\d+(?:\.\d+)?) float64\)$/.exec(law.trim()) : null
    const v = m ? Number(m[1]) : NaN
    if (!(v > 0 && v <= 100)) throw new Error("GovDAO's supermajority couldn't be read.")
    return v
}

export interface GovDaoState {
    tally: GovDaoTally
    /** The share either side needs, in percent (the law, read live). */
    supermajority: number
}

/** The tally and the rule it is held to, or null when the proposal page isn't this GovDAO's shape. */
export async function readGovDaoState(id: number): Promise<GovDaoState | null> {
    const [tally, supermajority] = await Promise.all([readGovDaoTally(id), readGovDaoSupermajority()])
    return tally ? { tally, supermajority } : null
}

export type GovDaoResolution = "execute" | "close"

/** What a call resolving this proposal does now, or null while neither side has the supermajority (the call would be refused). */
export function govDaoResolution({ tally: t, supermajority }: GovDaoState): GovDaoResolution | null {
    if (t.state !== "open") return null
    if (t.yes >= supermajority) return "execute"
    if (t.no >= supermajority) return "close"
    return null
}

/** The denied reason as written, without the markdown escapes the realm adds (it is shown as plain text). */
export function plainReason(reason: string): string {
    return reason.replace(/\\([!-/:-@[-`{-~])/g, "$1")
}

export const formatPercent = (v: number) => `${Math.floor(v * 100) / 100}%`

export interface GovDaoExecuteContext {
    id: number
    title: string
    /** What the chain showed when the member asked, so the review can't drift from it. */
    state: GovDaoState
    caller: string
    gasPrice: GasPrice
    /** Reads the proposal again when the re-check finds it changed. */
    refresh: () => void
}

export function govDaoExecuteRequest(ctx: GovDaoExecuteContext): SignRequest {
    const { id, caller } = ctx
    const mode = govDaoResolution(ctx.state)
    const { tally, supermajority } = ctx.state
    if (!mode) throw new Error(`Neither side of GovDAO proposal #${id} has the ${supermajority}% supermajority yet.`)
    const execute = mode === "execute"
    const plan = planDaoTx("govdao", GOVDAO_REALM, { type: "execute", id }, caller)
    const cap = formatUgnot(GOVDAO_BUDGETS.execute.maxDepositUgnot)
    const fee = sheetFee(plan, ctx.gasPrice)
    const verb = execute ? "Execute" : "Close"
    const memo = `${verb} GovDAO proposal #${id}`
    let pendingNote: string | undefined
    let failedNote: string | undefined
    let failedTitle: string | undefined

    const stateCheck = async () => {
        try {
            const fresh = await readGovDaoState(id)
            if (!fresh) throw new Error(`GovDAO proposal #${id} couldn't be read.`)
            // The review states the share needed: it must still be the law's.
            if (fresh.supermajority !== supermajority || govDaoResolution(fresh) !== mode) throw new Error(`Proposal #${id} changed since you opened this. Review it again.`)
        } catch (err) {
            ctx.refresh()
            throw err
        }
    }

    return {
        title: execute ? "Execute" : "Close as rejected",
        summary: `${verb} GovDAO #${id} “${revealInvisibleFormatting(ctx.title)}”`,
        sub: "GovDAO",
        lines: () => [
            execute
                ? ["Effect", "Runs the proposal's action with GovDAO's authority"]
                : ["Effect", "Marks the proposal denied; its action never runs"],
            execute ? ["Yes", `${formatPercent(tally.yes)} (needs ${supermajority}%)`] : ["No", `${formatPercent(tally.no)} (needs ${supermajority}%)`],
            ["Who may do this", "Any account, once one side has the supermajority"],
            ["Storage deposit", `up to ${cap}, paid by you for what ${execute ? "the proposal's action stores" : "this call stores"}`],
            fee.line,
            ["Network", GNO_CHAIN_ID],
        ],
        warns: [
            "This is final.",
            ...(execute ? [
                "If the proposal's action fails, GovDAO marks the proposal denied instead. Your transaction still goes through and pays the network fee.",
                `If the action needs more than ${(GOVDAO_BUDGETS.execute.gasWanted / 1e6).toFixed(0)}M gas or ${cap} of storage, the chain refuses this transaction: the proposal stays open and the network fee is still charged.`,
            ] : []),
        ],
        note: "Memba reads the tally and GovDAO's law again, and re-checks the fee, before signing.",
        label: () => `${verb} #${id}`,
        receipt: executeScope(GOVDAO_REALM, caller, id),
        prepare: () => ({ msgs: [plan.msg] }),
        recheck: async () => {
            await withFeeCheck(stateCheck(), fee.assertStillCovers())
        },
        send: (_choice, beforeSign) => broadcastDaoTx(plan, memo, beforeSign, { fee: fee.fee }),
        // Proof on chain: this transaction ran, and the proposal reads as resolved the way it should.
        verify: async (_choice, hash) => {
            const [after, tx] = await Promise.all([
                readGovDaoTally(id).catch(() => null),
                verifySendTx(hash).catch(() => false as const),
            ])
            pendingNote = failedNote = failedTitle = undefined
            if (tx === "failed") {
                failedNote = !after
                    ? `the chain refused this transaction, and proposal #${id}'s state couldn't be read right now. The network fee was still charged.`
                    : after.state !== "open"
                        ? `proposal #${id} was resolved by another transaction first. Yours was refused and changed nothing; the network fee was still charged.`
                        : `the chain refused this transaction and proposal #${id} is still open. The network fee was still charged.`
                return "failed"
            }
            if (tx !== true || !after || after.state === "open") {
                pendingNote = `Don't send it again: Memba is still waiting to see proposal #${id} resolved on chain.`
                return false
            }
            if (after.state === (execute ? "accepted" : "denied")) return true
            failedTitle = execute ? "Denied by GovDAO" : "Not denied"
            failedNote = !execute
                ? `proposal #${id} reads as accepted, not denied. Refresh it to see its state.`
                : after.reason
                    ? `the proposal's action failed, so GovDAO marked proposal #${id} denied (${plainReason(after.reason)}). Your transaction went through and paid the network fee; the action did not take effect.`
                    : `GovDAO marked proposal #${id} denied: its action did not run. Your transaction went through and paid the network fee.`
            return "failed"
        },
        pendingNote: () => pendingNote,
        failedNote: () => failedNote,
        failedTitle: () => failedTitle,
    }
}
