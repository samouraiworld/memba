/**
 * Fixed application adapters of the weighted host read contract
 * `memba-weighted-host/v12` (the mainnet governing DAO). Every shape here is
 * strict: an unknown field, operation or category rejects the whole read, and
 * the page never falls back to rendering prose.
 *
 * The empty string is the host's "unset" value for recipients, subjects,
 * signers and lanes. Operation-specific rules below mirror the host's own
 * action encoders, so a read that the host could not have produced is refused.
 */
import { z } from "zod"
import { revealInvisibleFormatting } from "./v2Text"
import { address, blank, optionalAddress, personID, role, sha256Hex, text, uint64 } from "./weightedPrimitives"

export type WeightedCategory = "routine" | "financial" | "critical"

/**
 * Routine and financial thresholds are fixed in the policy package
 * `gno.land/p/samcrew/memba_weighted_policy` (`State()`: routine
 * `WeightYes >= 3 && PeopleYes >= 2`, financial `WeightYes >= 5 && PeopleYes >= 3`)
 * and are not part of the config JSON. Both are ready as soon as they qualify;
 * only critical actions carry the 24h / 72h delays advertised in `roleChanges`.
 * weightedApplications.test.ts pins these values against the vendored source.
 */
export const IMMEDIATE_THRESHOLDS = {
    routine: { points: 3, people: 2 },
    financial: { points: 5, people: 3 },
} as const

export const APPLICATION_TARGETS = {
    market: "gno.land/r/samcrew/memba_market_config",
    reviewsV1: "gno.land/r/samcrew/memba_reviews_v1",
    reviewsV2: "gno.land/r/samcrew/memba_reviews_v2",
    quest: "gno.land/r/samcrew/memba_quest_attestation_v1",
    arcade: "gno.land/r/samcrew/memba_arcade_leaderboard_v1",
    appstore: "gno.land/r/samcrew/memba_appstore_v3",
    escrow: "gno.land/r/samcrew/escrow_v3",
    badges: "gno.land/r/samcrew/gnobuilders_badges_v2",
    feed: "gno.land/r/samcrew/memba_feed_v1",
    channels: "gno.land/r/samcrew/memba_dao_channels_v2",
    feedback: "gno.land/r/samcrew/memba_feedback_v2",
} as const

// ── Config: one closed policy object per adapter ──────────────────────────────

const staged = { successor: address, returnStagesOnly: z.literal(true), invalidatesOtherProposals: z.literal(true) }
const pausable = { unpauseCategory: z.literal("financial"), emergencyPause: z.literal(true) }
export const applicationPolicySchemas = {
    marketPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.market), treasury: address, ...staged }),
    reviewsPolicy: z.strictObject({ target: z.enum([APPLICATION_TARGETS.reviewsV1, APPLICATION_TARGETS.reviewsV2]), ...staged }),
    questPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.quest), signerCategory: z.literal("critical"), ...staged }),
    arcadePolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.arcade), attesterCategory: z.literal("critical"), ...pausable, ...staged }),
    appstorePolicy: z.strictObject({
        target: z.literal(APPLICATION_TARGETS.appstore), treasury: address, maxRegistrationFee: z.literal("100000000"),
        curatorCategory: z.literal("critical"), sealCategory: z.literal("critical"), moderationCategory: z.literal("routine"), ...pausable, ...staged,
    }),
    escrowPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.escrow), resolutionCategory: z.literal("financial"), ...pausable, ...staged }),
    badgesPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.badges), adminCategory: z.literal("critical"), ...pausable, ...staged }),
    feedPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.feed), moderatorCategory: z.literal("critical"), ...pausable, ...staged }),
    channelsPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.channels), memberCategory: z.literal("critical"), ...pausable, ...staged }),
    feedbackPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.feedback), memberCategory: z.literal("critical"), ...pausable, ...staged }),
}
export type ApplicationPolicyKey = keyof typeof applicationPolicySchemas
export const APPLICATION_POLICY_KEYS = Object.keys(applicationPolicySchemas) as ApplicationPolicyKey[]

// ── Actions ────────────────────────────────────────────────────────────────────

export const setRoleAction = z.strictObject({ type: z.literal("set-role"), target: address, role, grant: z.boolean() })
export const recoverMemberAction = z.strictObject({ type: z.literal("recover-member"), personId: personID, oldAddress: address, newAddress: address }).refine(a => a.oldAddress !== a.newAddress)

const RETURN_OPS = ["return-owner", "abort-return"] as const
const has = (list: readonly string[], value: string) => list.includes(value)
/** Field present exactly when the operation needs it. */
const exactly = (needed: boolean, value: string) => needed ? value !== "" : value === ""

const ownerState = { owner: address, pendingOwner: optionalAddress, paused: z.boolean() }
const count = uint64

const marketAction = z.strictObject({
    type: z.literal("market-config"), target: z.literal(APPLICATION_TARGETS.market),
    operation: z.enum(["accept-admin", "set-fee", "set-treasury", "return-admin", "abort-return"]),
    lane: z.enum(["", "nft", "service", "token"]), bps: z.number().int().min(0).max(500), recipient: optionalAddress,
    before: z.strictObject({ admin: address, pendingAdmin: optionalAddress, treasury: optionalAddress, bps: z.number().int().min(0).max(500) }),
}).refine(a => a.operation === "set-fee"
    ? a.lane !== "" && a.recipient === ""
    : a.lane === "" && a.bps === 0 && exactly(a.operation !== "accept-admin", a.recipient), "Malformed market action")

const reviewsItem = z.strictObject({
    id: uint64, review: z.boolean(), parentId: uint64, subject: text(1000), author: optionalAddress,
    rating: z.number().int().min(0).max(5), bodyHash: z.union([blank, sha256Hex]),
    // Block heights, not timestamps.
    createdAt: uint64, editedAt: uint64, hidden: z.boolean(), deleted: z.boolean(), flagged: z.boolean(),
})
const reviewsAction = z.strictObject({
    type: z.literal("reviews"), target: z.enum([APPLICATION_TARGETS.reviewsV1, APPLICATION_TARGETS.reviewsV2]),
    operation: z.enum(["accept-moderator", "return-moderator", "abort-return", "hide-review", "hide-comment", "unhide"]),
    id: uint64, recipient: optionalAddress,
    before: z.strictObject({ moderator: optionalAddress, pendingModerator: optionalAddress, item: reviewsItem }),
}).refine(a => {
    const item = has(["hide-review", "hide-comment", "unhide"], a.operation)
    return item ? a.id !== "0" && a.recipient === "" : a.id === "0" && exactly(a.operation !== "accept-moderator", a.recipient)
}, "Malformed reviews action")

const questAction = z.strictObject({
    type: z.literal("quest"), target: z.literal(APPLICATION_TARGETS.quest),
    operation: z.enum(["accept-owner", "set-signer", ...RETURN_OPS]),
    signer: z.union([blank, sha256Hex]), recipient: optionalAddress,
    before: z.strictObject({ owner: address, pendingOwner: optionalAddress, signer: z.union([blank, sha256Hex]) }),
}).refine(a => exactly(a.operation === "set-signer", a.signer) && exactly(has(RETURN_OPS, a.operation), a.recipient), "Malformed quest action")

const arcadeAction = z.strictObject({
    type: z.literal("arcade"), target: z.literal(APPLICATION_TARGETS.arcade),
    operation: z.enum(["accept-owner", ...RETURN_OPS, "add-attester", "remove-attester", "unpause"]),
    recipient: optionalAddress, attester: optionalAddress,
    before: z.strictObject({ ...ownerState, ownerListed: z.boolean(), daoListed: z.boolean(), successorListed: z.boolean(), subjectListed: z.boolean() }),
}).refine(a => exactly(has(RETURN_OPS, a.operation), a.recipient) && exactly(has(["add-attester", "remove-attester"], a.operation), a.attester), "Malformed arcade action")

const APPSTORE_LISTING = ["approve", "reject", "delist", "restore", "clear-flags"] as const
const appstoreAction = z.strictObject({
    type: z.literal("appstore"), target: z.literal(APPLICATION_TARGETS.appstore),
    operation: z.enum(["accept-owner", ...RETURN_OPS, "add-curator", "remove-curator", "set-fee", "set-treasury", "unpause", "seal-import", ...APPSTORE_LISTING]),
    recipient: optionalAddress, fee: uint64.refine(s => BigInt(s) <= 100000000n), path: text(200), reason: text(500),
    before: z.strictObject({
        owner: address, pendingOwner: optionalAddress, treasury: optionalAddress, fee: uint64, paused: z.boolean(), sealed: z.boolean(),
        ownerCurator: z.boolean(), daoCurator: z.boolean(), successorCurator: z.boolean(), subjectCurator: z.boolean(),
        listing: z.strictObject({ exists: z.boolean(), contentHash: z.union([blank, sha256Hex]), status: text(64), reason: text(500), credit: z.boolean(), flags: count, clearKeys: text(20000) }),
    }),
}).refine(a => {
    if (has(APPSTORE_LISTING, a.operation)) return a.recipient === "" && a.fee === "0" && /^gno\.land\/[rp]\//.test(a.path) && (a.operation === "reject" || a.reason === "")
    if (a.path !== "" || a.reason !== "") return false
    if (a.operation === "set-fee") return a.recipient === ""
    return a.fee === "0" && exactly(has([...RETURN_OPS, "set-treasury", "add-curator", "remove-curator"], a.operation), a.recipient)
}, "Malformed app store action")

const escrowNumber = uint64
const escrowAction = z.strictObject({
    type: z.literal("escrow"), target: z.literal(APPLICATION_TARGETS.escrow),
    operation: z.enum(["accept-owner", ...RETURN_OPS, "unpause", "refund-client", "pay-freelancer"]),
    recipient: optionalAddress, contractId: z.union([blank, uint64]), milestoneIndex: escrowNumber.refine(s => BigInt(s) < 20n),
    before: z.strictObject({
        ...ownerState,
        contract: z.strictObject({
            exists: z.boolean(), id: z.union([blank, uint64]), contentHash: z.union([blank, sha256Hex]), status: text(64), client: optionalAddress, freelancer: optionalAddress, count: escrowNumber,
            milestones: z.array(z.strictObject({ id: escrowNumber, amount: escrowNumber, status: text(64), fundedAt: escrowNumber, completedAt: escrowNumber, disputedAt: escrowNumber, preDisputeStatus: text(64) })).max(20),
        }).refine(c => BigInt(c.count) === BigInt(c.milestones.length), "Escrow milestone count mismatch"),
        fees: z.strictObject({ rawBPS: escrowNumber, effectiveBPS: escrowNumber, rawTreasury: optionalAddress, fallbackTreasury: optionalAddress, effectiveTreasury: optionalAddress }),
    }),
}).refine(a => {
    // milestoneIndex "0" is also the unset value outside dispute resolutions.
    // Contract IDs start at "0" (escrow_v3 allocates from a zero-valued counter).
    if (has(["refund-client", "pay-freelancer"], a.operation)) {
        const c = a.before.contract
        return a.contractId !== "" && a.recipient === "" && c.exists && c.id === a.contractId && BigInt(a.milestoneIndex) < BigInt(c.count)
    }
    return a.contractId === "" && a.milestoneIndex === "0" && exactly(has(RETURN_OPS, a.operation), a.recipient)
}, "Malformed escrow action")

const subjectAction = <T extends string, Ops extends readonly [string, ...string[]]>(type: T, target: string, ops: Ops, subjectOps: readonly string[], state: z.ZodRawShape) => z.strictObject({
    type: z.literal(type), target: z.literal(target), operation: z.enum(ops), recipient: optionalAddress, subject: optionalAddress,
    before: z.strictObject({ ...ownerState, ...state }),
}).refine(a => exactly(has(RETURN_OPS, a.operation), a.recipient) && exactly(subjectOps.includes(a.operation), a.subject), `Malformed ${type} action`)

const badgesAction = subjectAction("badges", APPLICATION_TARGETS.badges, ["accept-owner", ...RETURN_OPS, "add-admin", "remove-admin", "unpause"], ["add-admin", "remove-admin"],
    { adminCount: count, ownerAdmin: z.boolean(), daoAdmin: z.boolean(), successorAdmin: z.boolean(), subjectAdmin: z.boolean() })
const feedAction = subjectAction("feed", APPLICATION_TARGETS.feed, ["accept-owner", ...RETURN_OPS, "add-moderator", "remove-moderator", "unpause"], ["add-moderator", "remove-moderator"],
    { moderatorCount: count, ownerModerator: z.boolean(), daoModerator: z.boolean(), successorModerator: z.boolean(), subjectModerator: z.boolean() })

// Channels and feedback share one membership/room state shape in the host.
const roomState = {
    memberCount: count, membershipRevision: uint64,
    ownerMember: z.boolean(), daoMember: z.boolean(), successorMember: z.boolean(), subjectMember: z.boolean(),
    ownerRoles: text(500), daoRoles: text(500), successorRoles: text(500), subjectRoles: text(500),
    channelCount: count, channelExists: z.boolean(), channelDescription: text(1000), channelType: text(64), channelReadRoles: text(500), channelWriteRoles: text(500),
}
const ROOM_OPS = ["accept-owner", ...RETURN_OPS, "add-member", "remove-member", "set-roles", "create-text-channel", "unpause"] as const
const roomAction = <T extends "channels" | "feedback">(type: T, target: string) => z.strictObject({
    type: z.literal(type), target: z.literal(target), operation: z.enum(ROOM_OPS),
    recipient: optionalAddress, subject: optionalAddress, roles: text(500), name: text(64), description: text(1000),
    before: z.strictObject({ ...ownerState, ...roomState }),
}).refine(a => {
    const member = has(["add-member", "remove-member", "set-roles"], a.operation), create = a.operation === "create-text-channel"
    return exactly(has(RETURN_OPS, a.operation), a.recipient) && exactly(member, a.subject) && exactly(has(["add-member", "set-roles"], a.operation), a.roles) &&
        exactly(create, a.name) && (create || a.description === "")
}, `Malformed ${type} action`)

export const applicationActions = [
    marketAction, reviewsAction, questAction, arcadeAction, appstoreAction, escrowAction, badgesAction, feedAction,
    roomAction("channels", APPLICATION_TARGETS.channels), roomAction("feedback", APPLICATION_TARGETS.feedback),
] as const
export const v12Action = z.discriminatedUnion("type", [setRoleAction, recoverMemberAction, ...applicationActions])
export type WeightedV12Action = z.infer<typeof v12Action>
export type WeightedApplicationAction = Exclude<WeightedV12Action, { type: "set-role" | "recover-member" }>

/** Category the host assigns to an action; a read claiming another category is refused. */
export function expectedCategory(action: { type: string; operation?: string }): WeightedCategory {
    const op = action.operation ?? ""
    switch (action.type) {
        case "reviews": return has(["hide-review", "hide-comment", "unhide"], op) ? "routine" : "critical"
        case "appstore":
            if (has(APPSTORE_LISTING, op)) return "routine"
            return has(["set-fee", "set-treasury", "unpause"], op) ? "financial" : "critical"
        case "market-config": return has(["set-fee", "set-treasury"], op) ? "financial" : "critical"
        case "escrow": return has(["refund-client", "pay-freelancer", "unpause"], op) ? "financial" : "critical"
        case "arcade": case "badges": case "feed": case "channels": case "feedback": return op === "unpause" ? "financial" : "critical"
        default: return "critical"
    }
}

const POLICY_FOR: Record<WeightedApplicationAction["type"], ApplicationPolicyKey> = {
    "market-config": "marketPolicy", reviews: "reviewsPolicy", quest: "questPolicy", arcade: "arcadePolicy", appstore: "appstorePolicy",
    escrow: "escrowPolicy", badges: "badgesPolicy", feed: "feedPolicy", channels: "channelsPolicy", feedback: "feedbackPolicy",
}
export function policyKeyFor(action: WeightedApplicationAction): ApplicationPolicyKey { return POLICY_FOR[action.type] }

/** Configured destinations bind every staged return and treasury change. */
export function applicationActionMatchesPolicy(action: WeightedApplicationAction, policies: { [K in ApplicationPolicyKey]: z.infer<(typeof applicationPolicySchemas)[K]> }): boolean {
    const policy = policies[POLICY_FOR[action.type]]
    if (action.target !== policy.target) return false
    const op = action.operation
    if (op === "return-owner" || op === "return-admin" || op === "return-moderator" || op === "abort-return") return "recipient" in action && action.recipient === policy.successor
    if (op === "set-treasury" && "treasury" in policy) return action.recipient === policy.treasury
    return true
}

export const APPLICATION_LABELS: Record<WeightedApplicationAction["type"], string> = {
    "market-config": "Market config", reviews: "Reviews", quest: "Quests", arcade: "Arcade", appstore: "App Store",
    escrow: "Escrow", badges: "Badges", feed: "Feed", channels: "DAO channels", feedback: "Feedback",
}

/** Operation parameters worth showing, in host field order; unset values are omitted. Invisible and bidi characters are made visible. */
export function applicationDetails(action: WeightedApplicationAction): [string, string][] {
    const skip = new Set(["type", "target", "operation", "before"])
    const out: [string, string][] = []
    for (const [key, value] of Object.entries(action)) {
        if (skip.has(key) || value === "" || (action.type === "escrow" && key === "milestoneIndex" && action.contractId === "") || (action.type === "market-config" && key === "bps" && action.operation !== "set-fee") || (action.type === "appstore" && key === "fee" && action.operation !== "set-fee") || (action.type === "reviews" && key === "id" && value === "0")) continue
        out.push([key, revealInvisibleFormatting(String(value))])
    }
    return out
}

/** Flatten the frozen pre-state into labelled rows (nested objects use dotted keys); invisible characters are made visible. */
export function flattenBefore(value: unknown, prefix = ""): [string, string][] {
    if (value === null || typeof value !== "object") return [[prefix, value === "" ? "(unset)" : revealInvisibleFormatting(String(value))]]
    const rows: [string, string][] = []
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
    if (entries.length === 0) return [[prefix, "(none)"]]
    for (const [key, v] of entries) rows.push(...flattenBefore(v, prefix ? `${prefix}.${key}` : key))
    return rows
}
