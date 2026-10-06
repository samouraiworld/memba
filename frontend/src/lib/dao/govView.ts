/**
 * Words for memba_gov in the Memba DAO windows. The class rules are constants
 * of the realm's code; durations come from its ConstantsJSON.
 */
import { formatChainTime } from "./v2Lifecycle"
import { decodeGovAction, type GovValueKind } from "./govActions"
import type { GovConstants, GovProposal } from "./membaGov"

export const GOV_STATUS_TEXT: Record<GovProposal["status"], string> = {
    voting: "Voting", timelocked: "Passed, waiting out its delay", ready: "Ready to execute",
    executed: "Executed", invalidated: "Invalidated", expired: "Expired",
}

/** "7 days", "24 hours", "90 minutes". */
export function durationText(seconds: number): string {
    if (seconds % 86400 === 0) return `${seconds / 86400} ${seconds === 86400 ? "day" : "days"}`
    if (seconds % 3600 === 0) return `${seconds / 3600} ${seconds === 3600 ? "hour" : "hours"}`
    return `${Math.round(seconds / 60)} minutes`
}

/** How each class passes, from YES votes of seated members. */
export function classRules(c: GovConstants) {
    return [
        { name: "Routine", rule: "at least 3/8 of the weight and 2 people, no delay" },
        { name: "Financial", rule: "at least 3/5 of the weight, 3 people and more than half of the people, no delay" },
        {
            name: "Critical",
            rule: `at least 2/3 of the weight and more than half of the people, then ${durationText(c.criticalWeightDelay)}; `
                + `or at least 2/3 of the people and more than half of the weight, then ${durationText(c.criticalHeadcountDelay)}`,
        },
    ]
}

export function rosterRules(c: GovConstants): string {
    return `A key counts only after it signed Join itself. Inviting, removing, re-weighting a member or recovering a member's key is critical and waits ${durationText(c.rosterDelay)}; `
        + `an unused invitation can be revoked by a financial vote. Roster changes execute one at a time, and each, like each Join, ends every open proposal. Someone who has not proposed, voted, executed or joined for ${durationText(c.inactiveAfter)} `
        + `can be removed by a routine vote after ${durationText(c.inactiveDelay)}; doing any of these meanwhile stops it. `
        + `The roster holds ${c.minSeats} to ${c.maxSeats} people.`
}

export function votingRules(c: GovConstants): string {
    return `Voting lasts ${durationText(c.votingPeriod)}: yes, no or abstain, changeable until it closes; a YES can be withdrawn later until execution. `
        + `NO votes do not block. A passed proposal must execute within ${durationText(c.executionWindow)} after voting and its delay end.`
}

/** A decoded value as the window shows it. */
export function valueText(kind: GovValueKind, value: string): string {
    if (value === "") return "(none)"
    switch (kind) {
        case "ugnot": {
            const v = BigInt(value), sign = v < 0n ? "-" : "", abs = v < 0n ? -v : v
            const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")
            return `${sign}${(abs / 1_000_000n).toLocaleString("en-US")}${frac ? `.${frac}` : ""} GNOT`
        }
        case "bps": return `${(Number(value) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% (${value} bps)`
        case "time": return value === "0" ? "now (0)" : `${formatChainTime(Number(value))} (unix ${value})`
        case "height": return `block ${value}`
        case "yesno": return value === "1" ? "Yes" : "No"
        default: return value
    }
}

export function govReadError(error: unknown): string {
    return error instanceof Error && error.message.includes("network does not match")
        ? "The RPC answered for another chain, so nothing it said is shown."
        : "Couldn't read Memba DAO. The network may be busy."
}

/** What a proposal does in a few words; an action Memba cannot read says so. */
export function govProposalTitle(p: GovProposal): string {
    return decodeGovAction(p.target, p.action, p.args)?.title ?? `Unknown action ${p.action} on ${p.target}`
}
