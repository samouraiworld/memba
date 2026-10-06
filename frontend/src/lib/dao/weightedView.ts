/**
 * Display text for weighted DAO reads, shared by the classic workspace
 * (pages/WeightedDAO) and the Memba OS DAO windows (os/daos/WeightedDao*).
 * Realm-controlled text is passed through revealInvisibleFormatting.
 */
import { DAO_REALM_PATH } from "../config"
import { revealInvisibleFormatting as reveal } from "./v2Text"
import { WEIGHTED_APPLICATIONS_SCHEMA, type WeightedBallot, type WeightedConfig, type WeightedInvalidation, type WeightedMember, type WeightedProposal } from "./weighted"
import { APPLICATION_LABELS, IMMEDIATE_THRESHOLDS, OPERATION_WORDS, policyOperations, type ApplicationPolicyKey, type WeightedCategory } from "./weightedApplications"
import { formatUgnotExact } from "./v2Budget"

/** What a weighted DAO is called in its windows: the governing DAO by its name, any other by its folder name. */
export function weightedDaoTitle(realmPath: string, name: string): string {
    return realmPath === DAO_REALM_PATH ? "Memba DAO" : name
}

export const CATEGORY_TEXT = { routine: "Routine", financial: "Financial", critical: "Critical" } as const

export const POLICY_LABELS: Record<ApplicationPolicyKey, string> = {
    marketPolicy: APPLICATION_LABELS["market-config"], reviewsPolicy: APPLICATION_LABELS.reviews, questPolicy: APPLICATION_LABELS.quest, arcadePolicy: APPLICATION_LABELS.arcade,
    appstorePolicy: APPLICATION_LABELS.appstore, escrowPolicy: APPLICATION_LABELS.escrow, badgesPolicy: APPLICATION_LABELS.badges, feedPolicy: APPLICATION_LABELS.feed,
    channelsPolicy: APPLICATION_LABELS.channels, feedbackPolicy: APPLICATION_LABELS.feedback,
}

/** A proposal that can still execute: it is voted on, waits for its delay, or is ready. */
const OPEN_STATUSES: readonly WeightedProposal["status"][] = ["VOTING", "TIMELOCKED", "READY"]
export function isOpenProposal(p: Pick<WeightedProposal, "status">): boolean { return OPEN_STATUSES.includes(p.status) }

/** Ballots are accepted until the voting deadline, whatever the open status. */
export function isVoteOpen(p: Pick<WeightedProposal, "status" | "votingClosed">): boolean { return !p.votingClosed && isOpenProposal(p) }

/** One voter's ballot as read, as failed ("error"), or not read yet (undefined). */
export type BallotView = WeightedBallot | "error" | undefined

export function ballotText(ballot: BallotView, open: boolean): string | null {
    if (ballot === undefined) return null
    if (ballot === "error") return "Your ballot could not be read."
    if (!ballot.eligible) return "Your address is not eligible to vote on this proposal."
    if (ballot.choice) return `You voted ${ballot.choice} (block ${ballot.votedAtHeight}).`
    return open ? "You have not voted." : "You did not vote."
}

function invalidationText(v: WeightedInvalidation): string {
    // A pause always names the application it paused (the read contract refuses one that does not).
    if (v.cause === "pause") return `Invalidated at block ${v.height}: a member paused ${reveal(v.target!)}.`
    return `Invalidated at block ${v.height}: proposal #${v.proposalId} executed${v.target ? ` (${reveal(v.target)})` : ""}.`
}

const count = (n: number | null, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The yes side of the tally; the host clears it once a proposal is executed or invalidated. */
export function tallyText(p: Pick<WeightedProposal, "talliesAvailable" | "weightYes" | "peopleYes" | "developersYes">): string {
    if (!p.talliesAvailable) return "Historical vote totals are unavailable."
    return `${count(p.weightYes, "point", "points")} · ${count(p.peopleYes, "person", "people")} · ${count(p.developersYes, "developer", "developers")} voting yes`
}

export const STATUS_TEXT: Record<WeightedProposal["status"], string> = {
    VOTING: "Voting", TIMELOCKED: "Waiting for its delay", READY: "Ready to execute", EXPIRED: "Expired", INVALIDATED: "Invalidated", EXECUTED: "Executed",
}

/** A failed read, in words: a contract Memba cannot validate says so; any other failure keeps its own message. */
export function weightedReadError(err: unknown): string {
    return err instanceof Error && err.name !== "ZodError" ? err.message : "Could not validate weighted governance data. Confirm the realm supports this DAO version, then refresh."
}

export interface DecisionRule {
    category: WeightedCategory
    /** What the category decides. */
    covers: string
    /** Each way a proposal of this category passes. */
    routes: string[]
    /** False when a proposal can execute as soon as it passes. */
    delayed: boolean
}

const hours = (seconds: number) => count(seconds / 3600, "hour", "hours")

/** The DAO's size: "7 seats · 8 voting points". */
export function seatsSummary(config: WeightedConfig): string {
    return `${config.rosterSize} seats · ${config.totalPoints} voting points`
}

/** Memba OS builds no weighted DAO call; off the held chains, the classic page acts on versions 1 and 2. */
export const OS_READS_ONLY = "Memba OS only reads this version of the DAO's contract; Memba's classic DAO page acts on it."

/** Said wherever v12 actions used to be, in Memba OS and on the classic page: Memba DAO's own move, or the plain rule for any other v12 realm. */
export const V12_READ_ONLY = "Memba DAO is moving to a new governance contract. This version is read-only in Memba; no proposal, vote or execution can be made here."
export const V12_READ_ONLY_OTHER = "This DAO version is read-only in Memba; no proposal, vote or execution can be made here."
export function v12ReadOnlyText(realmPath: string): string { return realmPath === DAO_REALM_PATH ? V12_READ_ONLY : V12_READ_ONLY_OTHER }

/** What a role does not give. */
export const ROLES_ADD_NOTHING = "Admin and finance roles add no voting power and no exclusive right to execute."

/** The governance write hold: no call is built for a weighted DAO on this network. */
export function writesHeldText(chainId: string): string {
    return `This DAO is read-only in Memba on ${chainId}: Memba builds no governance transaction for it here.`
}

/** How the seats weigh, in one sentence. */
export function seatsRule(config: WeightedConfig): string {
    return `The founder's seat carries ${count(config.founderWeight, "point", "points")}; each developer's carries ${count(config.developerWeight, "point", "points")}.`
}

/** How long voting lasts, and what passing before the end keeps. */
export function votingRule(config: WeightedConfig): string {
    return `Voting lasts ${durationText(config.votingPeriodSeconds)}; a proposal that passes before voting closes keeps its delay.`
}

/** What an execution does to the other proposals. */
export function invalidationRule(config: WeightedConfig): string {
    return `Executing any proposal${config.schema === WEIGHTED_APPLICATIONS_SCHEMA ? ", or any emergency pause," : ""} invalidates every other open proposal.`
}

/** The voting period in words: whole days when it is some, hours otherwise. */
export function durationText(seconds: number): string {
    return seconds % 86400 === 0 ? count(seconds / 86400, "day", "days") : hours(seconds)
}

/** How proposals pass, from the contract's own numbers. Financial and routine decisions exist from the application version on. */
export function decisionRules(config: WeightedConfig): DecisionRule[] {
    const rc = config.roleChanges
    const applications = config.schema === WEIGHTED_APPLICATIONS_SCHEMA
    const critical: DecisionRule = {
        category: "critical",
        covers: applications ? "role changes, key recoveries, authority handoffs and appointments" : config.capabilities.memberReplacement ? "role changes and key recoveries" : "role changes",
        routes: [
            `${rc.weightedPoints} points and at least ${rc.weightedPeople} people, then ${hours(rc.weightedDelaySeconds)}`,
            `${rc.independentDevelopers} developers, then ${hours(rc.independentDelaySeconds)}`,
        ],
        delayed: true,
    }
    if (!applications) return [critical]
    const immediate = (category: "financial" | "routine", covers: string): DecisionRule => ({
        category, covers, routes: [`${IMMEDIATE_THRESHOLDS[category].points} points and at least ${IMMEDIATE_THRESHOLDS[category].people} people`], delayed: false,
    })
    return [critical, immediate("financial", "fees, treasuries, unpausing and escrow disputes"), immediate("routine", "moderation")]
}

/** A seat in words: "Founder · 2 points" or "Core developer · 1 point". */
export function seatText(m: Pick<WeightedMember, "founder" | "weight">): string {
    return `${m.founder ? "Founder" : "Core developer"} · ${count(m.weight, "point", "points")}`
}

/** The roles a seat carries; they add no voting power and no exclusive right to execute. */
export function roleText(m: Pick<WeightedMember, "admin" | "finance">): string {
    return [m.admin && "Admin", m.finance && "Finance"].filter(Boolean).join(" · ") || "No admin or finance role"
}

/** A proposal the contract returned but Memba could not validate. */
export const UNREADABLE_PROPOSAL = "Memba could not validate this proposal against the DAO contract, so it is not shown and cannot be acted on here. Other proposals are unaffected."

/** Shown on every open proposal: one execution voids all the others. */
export const EXECUTION_INVALIDATES = "Executing this proposal invalidates every other outstanding proposal."

/** Why a proposal stands where it does, when its status alone does not say. */
export function statusNote(p: Pick<WeightedProposal, "status" | "category" | "invalidation">): string | null {
    // Realms published before invalidation records say only that it happened; those versions have no pause.
    if (p.status === "INVALIDATED") return p.invalidation ? invalidationText(p.invalidation) : "Invalidated: another proposal executed after this was proposed."
    if (p.status === "TIMELOCKED") return "It passed. It can execute from the earliest time below."
    if (p.status === "READY" && p.category !== "critical") return `${CATEGORY_TEXT[p.category]} proposals can execute as soon as they pass.`
    return null
}

/** A chain time in the reader's own time zone, with the zone named. */
export function chainTimeText(iso: string): string {
    return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}

export interface ProposalTime {
    label: string
    /** The chain's own time, for a <time> element. */
    iso: string
    text: string
}

/**
 * When voting closes and when each way of passing lets it execute. The chain closes voting by
 * time alone, so a proposal that is executed or invalidated before its
 * deadline is said to be over, not to close later.
 */
export function proposalTimes(p: Pick<WeightedProposal, "status" | "votingDeadline" | "votingClosed" | "weightedAfter" | "developerAfter">): ProposalTime[] {
    const at = (label: string, iso: string, text = chainTimeText(iso)) => ({ label, iso, text })
    const voting = isVoteOpen(p) ? at("Voting closes", p.votingDeadline)
        : p.votingClosed ? at("Voting closed", p.votingDeadline)
            : at("Voting", p.votingDeadline, `Over (the proposal is ${STATUS_TEXT[p.status].toLowerCase()})`)
    return [
        voting,
        ...(p.weightedAfter ? [at("Executable from (points vote)", p.weightedAfter)] : []),
        ...(p.developerAfter ? [at("Executable from (developers' vote)", p.developerAfter)] : []),
    ]
}

const list = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

/**
 * One application's rules as the contract enforces them: every operation the
 * DAO can vote on, grouped by the category the host assigns it; who may pause
 * it; the fee cap; where a handover back goes. They apply while the DAO
 * controls the application.
 */
export function applicationRules(key: ApplicationPolicyKey, policy: { successor: string } & Record<string, unknown>): string[] {
    const operations = policyOperations(key)
    const decides = new Map<WeightedCategory, string[]>()
    for (const { operation, category } of operations) {
        const words = operation in OPERATION_WORDS ? OPERATION_WORDS[operation].rule : operation
        if (words === null) continue
        const known = decides.get(category) ?? []
        if (!known.includes(words)) decides.set(category, [...known, words])
    }
    const rules = (["critical", "financial", "routine"] as const).filter((c) => decides.has(c)).map((c) => `${CATEGORY_TEXT[c]} votes cover ${list(decides.get(c)!)}.`)
    const unpause = operations.find((o) => o.operation === "unpause")
    if (policy.emergencyPause === true && unpause) rules.push(`While the DAO controls it, any member can pause it at once; unpausing takes a ${unpause.category} vote.`)
    if (typeof policy.maxRegistrationFee === "string") rules.push(`A fee vote can set at most ${formatUgnotExact(Number(policy.maxRegistrationFee))}.`)
    rules.push(`Handing it back takes a critical vote and goes only to ${reveal(policy.successor)}, who must accept.`)
    return rules
}
