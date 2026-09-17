/**
 * Lifecycle facts of a version-2 DAO proposal, derived from the realm's own
 * record (times are block times in unix seconds).
 */
import type { MembaV2ProposalSummary, MembaV2Status } from "./membaV2"

export const V2_STATUS_LABELS: Record<MembaV2Status, string> = {
    ACTIVE: "Voting",
    ACCEPTED: "Accepted",
    REJECTED: "Rejected",
    EXECUTED: "Executed",
    EXPIRED: "Expired",
    LAPSED: "Lapsed",
    INVALIDATED: "Invalidated",
    ARCHIVED: "Closed",
}

export const V2_STATUS_EXPLANATIONS: Record<MembaV2Status, string> = {
    ACTIVE: "Members can vote until the voting period ends.",
    ACCEPTED: "The threshold was reached. Any member can execute it during the execution window.",
    REJECTED: "The threshold can no longer be reached.",
    EXECUTED: "The proposal was applied.",
    EXPIRED: "Voting ended before the threshold was reached.",
    LAPSED: "It was accepted but not executed before the execution window closed.",
    INVALIDATED: "Membership changed while it was open, so it can no longer be voted on.",
    ARCHIVED: "The DAO was archived, so it can no longer be voted on or executed.",
}

export const VOTES_ARE_FINAL = "Votes are final; a proposal is accepted as soon as the threshold is reached."

export function formatChainTime(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
}

/** "in 3h 20m", "2d 4h ago", "now". */
export function relativeTime(seconds: number, nowSeconds: number): string {
    const diff = seconds - nowSeconds
    const abs = Math.abs(diff)
    if (abs < 60) return "now"
    const d = Math.floor(abs / 86400)
    const h = Math.floor((abs % 86400) / 3600)
    const m = Math.floor((abs % 3600) / 60)
    const text = d > 0 ? `${d}d${h > 0 ? ` ${h}h` : ""}` : h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`
    return diff > 0 ? `in ${text}` : `${text} ago`
}

export type V2Proposal = MembaV2ProposalSummary

export function canVoteNow(p: V2Proposal, nowSeconds: number): boolean {
    return p.status === "ACTIVE" && nowSeconds < p.voting_ends_at
}

/** "not-accepted" | "too-early" | "open" | "closed", from the member's clock. */
export function executionState(p: V2Proposal, nowSeconds: number): "not-accepted" | "too-early" | "open" | "closed" {
    if (p.status !== "ACCEPTED") return "not-accepted"
    if (nowSeconds < p.executable_at) return "too-early"
    if (nowSeconds > p.execute_by) return "closed"
    return "open"
}

/** Percent of the electorate's power, one decimal. */
export function powerPercent(part: number, whole: number): number {
    return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}
