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
import { sha256 } from "@noble/hashes/sha2.js"
import { bech32Encode } from "./realmAddress"
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
    escrow: "gno.land/r/samcrew/escrow_v4",
    badges: "gno.land/r/samcrew/gnobuilders_badges_v2",
    feed: "gno.land/r/samcrew/memba_feed_v1",
    channels: "gno.land/r/samcrew/memba_dao_channels_v2",
    feedback: "gno.land/r/samcrew/memba_feedback_v2",
} as const

// ── Config: one closed policy object per adapter ──────────────────────────────

const staged = { successor: address, returnStagesOnly: z.literal(true), invalidatesOtherProposals: z.literal(true) }
const category = z.enum(["routine", "financial", "critical"])
const pausable = { unpauseCategory: category, emergencyPause: z.literal(true) }

/**
 * Each published category field names the category of one operation. The
 * reader checks it against expectedCategory (the host's own classification)
 * instead of trusting either side alone.
 */
const CATEGORY_WITNESS: Record<string, Record<string, [string, string]>> = {
    marketPolicy: { feeCategory: ["market-config", "set-fee"], treasuryCategory: ["market-config", "set-treasury"] },
    reviewsPolicy: { moderationCategory: ["reviews", "hide-review"] },
    questPolicy: { signerCategory: ["quest", "set-signer"] },
    arcadePolicy: { attesterCategory: ["arcade", "add-attester"], unpauseCategory: ["arcade", "unpause"] },
    appstorePolicy: { curatorCategory: ["appstore", "add-curator"], sealCategory: ["appstore", "seal-import"], moderationCategory: ["appstore", "approve"], unpauseCategory: ["appstore", "unpause"] },
    escrowPolicy: { resolutionCategory: ["escrow", "refund-client"], unpauseCategory: ["escrow", "unpause"], feeRecipientCategory: ["escrow", "set-fee-recipient"] },
    badgesPolicy: { adminCategory: ["badges", "add-admin"], unpauseCategory: ["badges", "unpause"] },
    feedPolicy: { moderatorCategory: ["feed", "add-moderator"], unpauseCategory: ["feed", "unpause"] },
    channelsPolicy: { memberCategory: ["channels", "add-member"], unpauseCategory: ["channels", "unpause"] },
    feedbackPolicy: { memberCategory: ["feedback", "add-member"], unpauseCategory: ["feedback", "unpause"] },
}
const categoriesMatch = (key: string) => (policy: Record<string, unknown>) =>
    Object.entries(CATEGORY_WITNESS[key]).every(([field, [type, operation]]) => policy[field] === expectedCategory({ type, operation }))

export const applicationPolicySchemas = {
    marketPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.market), treasury: address, feeCategory: category, treasuryCategory: category, ...staged }).refine(categoriesMatch("marketPolicy"), "Unexpected market categories"),
    reviewsPolicy: z.strictObject({ target: z.enum([APPLICATION_TARGETS.reviewsV1, APPLICATION_TARGETS.reviewsV2]), moderationCategory: category, ...staged }).refine(categoriesMatch("reviewsPolicy"), "Unexpected reviews categories"),
    questPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.quest), signerCategory: category, ...staged }).refine(categoriesMatch("questPolicy"), "Unexpected quest categories"),
    arcadePolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.arcade), attesterCategory: category, ...pausable, ...staged }).refine(categoriesMatch("arcadePolicy"), "Unexpected arcade categories"),
    appstorePolicy: z.strictObject({
        target: z.literal(APPLICATION_TARGETS.appstore), treasury: address, maxRegistrationFee: z.literal("100000000"),
        curatorCategory: category, sealCategory: category, moderationCategory: category, ...pausable, ...staged,
    }).refine(categoriesMatch("appstorePolicy"), "Unexpected App Store categories"),
    escrowPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.escrow), resolutionCategory: category, feeRecipientCategory: category, ...pausable, ...staged }).refine(categoriesMatch("escrowPolicy"), "Unexpected escrow categories"),
    badgesPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.badges), adminCategory: category, ...pausable, ...staged }).refine(categoriesMatch("badgesPolicy"), "Unexpected badges categories"),
    feedPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.feed), moderatorCategory: category, ...pausable, ...staged }).refine(categoriesMatch("feedPolicy"), "Unexpected feed categories"),
    channelsPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.channels), memberCategory: category, ...pausable, ...staged }).refine(categoriesMatch("channelsPolicy"), "Unexpected channels categories"),
    feedbackPolicy: z.strictObject({ target: z.literal(APPLICATION_TARGETS.feedback), memberCategory: category, ...pausable, ...staged }).refine(categoriesMatch("feedbackPolicy"), "Unexpected feedback categories"),
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

const basisPoints = uint64.refine(s => BigInt(s) <= 500n)
const marketAction = z.strictObject({
    type: z.literal("market-config"), target: z.literal(APPLICATION_TARGETS.market),
    operation: z.enum(["accept-admin", "set-fee", "set-treasury", "return-admin", "abort-return"]),
    lane: z.enum(["", "nft", "service", "token"]), bps: basisPoints, recipient: optionalAddress,
    before: z.strictObject({ admin: address, pendingAdmin: optionalAddress, treasury: optionalAddress, bps: basisPoints }),
}).refine(a => a.operation === "set-fee"
    ? a.lane !== "" && a.recipient === ""
    : a.lane === "" && a.bps === "0" && exactly(a.operation !== "accept-admin", a.recipient), "Malformed market action")

const reviewsItem = z.strictObject({
    id: uint64, review: z.boolean(), parentId: uint64, subject: text(1000), author: optionalAddress,
    rating: z.enum(["0", "1", "2", "3", "4", "5"]), bodyHash: z.union([blank, sha256Hex]),
    createdAtHeight: uint64, editedAtHeight: uint64, hidden: z.boolean(), deleted: z.boolean(), flagged: z.boolean(),
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
/** The on-chain address of a realm: bech32("g", sha256("pkgPath:" + path)[:20]). */
export function packageAddress(realmPath: string): string {
    return bech32Encode("g", sha256(new TextEncoder().encode("pkgPath:" + realmPath)).slice(0, 20))
}
const ESCROW_ADDRESS = packageAddress(APPLICATION_TARGETS.escrow)
const escrowAction = z.strictObject({
    type: z.literal("escrow"), target: z.literal(APPLICATION_TARGETS.escrow),
    operation: z.enum(["accept-owner", ...RETURN_OPS, "unpause", "refund-client", "pay-freelancer", "set-fee-recipient"]),
    // Only the two dispute actions name a milestone; it is null everywhere else.
    recipient: optionalAddress, contractId: z.union([blank, uint64]), milestoneIndex: escrowNumber.refine(s => BigInt(s) < 20n).nullable(),
    // escrow_v4 pre-state. The height-derived exitsOpen and pausedBlocks are
    // deliberately not frozen, so they must not appear here.
    before: z.strictObject({
        owner: address, pendingOwner: optionalAddress, feeRecipient: address, pendingFeeRecipient: optionalAddress,
        paused: z.boolean(), pausedAt: uint64, exitsReopenAt: uint64, cooldownUntil: uint64,
        contract: z.strictObject({
            exists: z.boolean(), id: z.union([blank, uint64]), contentHash: z.union([blank, sha256Hex]), status: text(64), client: optionalAddress, freelancer: optionalAddress, count: escrowNumber,
            milestones: z.array(z.strictObject({ id: escrowNumber, amount: escrowNumber, status: text(64), fundedAt: escrowNumber, completedAt: escrowNumber, disputedAt: escrowNumber, preDisputeStatus: text(64) })).max(20),
        // escrow_v4 numbers each milestone by its index.
        }).refine(c => BigInt(c.count) === BigInt(c.milestones.length) && c.milestones.every((m, i) => m.id === String(i)), "Escrow milestone count or IDs mismatch"),
        fees: z.strictObject({ rawBPS: escrowNumber, effectiveBPS: escrowNumber, rawTreasury: optionalAddress, fallbackTreasury: optionalAddress, effectiveTreasury: optionalAddress }),
    }).refine(s => s.paused ? BigInt(s.pausedAt) > 0n && BigInt(s.exitsReopenAt) > BigInt(s.pausedAt) : s.pausedAt === "0" && s.exitsReopenAt === "0", "Inconsistent escrow pause state"),
}).refine(a => {
    // Contract IDs start at "0" (the escrow realm allocates from a zero-valued counter).
    if (a.operation === "set-fee-recipient") {
        // Stages a new fallback fee recipient; never the escrow realm itself
        // (the DAO is checked against the config's realm path), never a no-op.
        const s = a.before
        return a.recipient !== "" && a.contractId === "" && a.milestoneIndex === null && a.recipient !== ESCROW_ADDRESS && a.recipient !== s.feeRecipient && a.recipient !== s.pendingFeeRecipient
    }
    if (has(["refund-client", "pay-freelancer"], a.operation)) {
        const c = a.before.contract
        return a.milestoneIndex !== null && a.contractId !== "" && a.recipient === "" && c.exists && c.id === a.contractId && BigInt(a.milestoneIndex) < BigInt(c.count)
    }
    return a.contractId === "" && a.milestoneIndex === null && exactly(has(RETURN_OPS, a.operation), a.recipient)
}, "Malformed escrow action")

const subjectAction = <T extends string, Ops extends readonly [string, ...string[]]>(type: T, target: string, ops: Ops, subjectOps: readonly string[], state: z.ZodRawShape) => z.strictObject({
    type: z.literal(type), target: z.literal(target), operation: z.enum(ops), recipient: optionalAddress, subject: optionalAddress,
    before: z.strictObject({ ...ownerState, ...state }),
}).refine(a => exactly(has(RETURN_OPS, a.operation), a.recipient) && exactly(subjectOps.includes(a.operation), a.subject), `Malformed ${type} action`)

const badgesAction = subjectAction("badges", APPLICATION_TARGETS.badges, ["accept-owner", ...RETURN_OPS, "add-admin", "remove-admin", "unpause"], ["add-admin", "remove-admin"],
    { adminCount: count, ownerAdmin: z.boolean(), daoAdmin: z.boolean(), successorAdmin: z.boolean(), subjectAdmin: z.boolean() })
const feedAction = subjectAction("feed", APPLICATION_TARGETS.feed, ["accept-owner", ...RETURN_OPS, "add-moderator", "remove-moderator", "unpause"], ["add-moderator", "remove-moderator"],
    { moderatorCount: count, ownerModerator: z.boolean(), daoModerator: z.boolean(), successorModerator: z.boolean(), subjectModerator: z.boolean() })

// Channels and feedback share membership fields; each names its own room fields.
const membershipState = {
    memberCount: count, membershipRevision: uint64,
    ownerMember: z.boolean(), daoMember: z.boolean(), successorMember: z.boolean(), subjectMember: z.boolean(),
    ownerRoles: text(500), daoRoles: text(500), successorRoles: text(500), subjectRoles: text(500),
}
const roomState = {
    channels: { channelCount: count, channelExists: z.boolean(), channelDescription: text(1000), channelType: text(64), channelReadRoles: text(500), channelWriteRoles: text(500) },
    feedback: { feedbackChannelCount: count, feedbackChannelExists: z.boolean(), feedbackChannelDescription: text(1000), feedbackChannelType: text(64), feedbackChannelReadRoles: text(500), feedbackChannelWriteRoles: text(500) },
}
const ROOM_OPS = ["accept-owner", ...RETURN_OPS, "add-member", "remove-member", "set-roles", "create-text-channel", "unpause"] as const
const roomAction = <T extends "channels" | "feedback">(type: T, target: string) => z.strictObject({
    type: z.literal(type), target: z.literal(target), operation: z.enum(ROOM_OPS),
    recipient: optionalAddress, subject: optionalAddress, roles: text(500), name: text(64), description: text(1000),
    before: z.strictObject({ ...ownerState, ...membershipState, ...roomState[type] }),
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
        case "escrow": return has(["refund-client", "pay-freelancer", "unpause", "set-fee-recipient"], op) ? "financial" : "critical"
        case "arcade": case "badges": case "feed": case "channels": case "feedback": return op === "unpause" ? "financial" : "critical"
        default: return "critical"
    }
}

const POLICY_FOR: Record<WeightedApplicationAction["type"], ApplicationPolicyKey> = {
    "market-config": "marketPolicy", reviews: "reviewsPolicy", quest: "questPolicy", arcade: "arcadePolicy", appstore: "appstorePolicy",
    escrow: "escrowPolicy", badges: "badgesPolicy", feed: "feedPolicy", channels: "channelsPolicy", feedback: "feedbackPolicy",
}

const LISTINGS = "approving, rejecting, delisting and restoring listings, and clearing their flags"
const DISPUTES = "settling disputes (refunding the client or paying the freelancer)"
const HANDOVER = null
/**
 * Every application operation in words, in one place: `title` names a
 * proposal for it ("Set a fee"); `rule` is how the DAO's rules list it
 * ("fees"), shared by the operations that make one decision, and null where
 * the rules say it in their own sentence (handovers, unpausing).
 */
export const OPERATION_WORDS: Readonly<Record<string, { title: string; rule: string | null }>> = {
    "accept-admin": { title: "Accept the handover", rule: HANDOVER }, "accept-owner": { title: "Accept the handover", rule: HANDOVER }, "accept-moderator": { title: "Accept the handover", rule: HANDOVER },
    "return-admin": { title: "Hand it back", rule: HANDOVER }, "return-owner": { title: "Hand it back", rule: HANDOVER }, "return-moderator": { title: "Hand it back", rule: HANDOVER },
    "abort-return": { title: "Cancel the hand-back", rule: HANDOVER }, unpause: { title: "Unpause", rule: null },
    "set-fee": { title: "Set a fee", rule: "fees" }, "set-treasury": { title: "Set the treasury", rule: "the treasury" },
    // Staged only: the nominated address accepts in its own transaction.
    "set-fee-recipient": { title: "Nominate the fallback fee recipient", rule: "nominating the fallback fee recipient" },
    "hide-review": { title: "Hide a review", rule: "hiding reviews and comments" }, "hide-comment": { title: "Hide a comment", rule: "hiding reviews and comments" },
    unhide: { title: "Show a hidden review or comment", rule: "showing them again" },
    "set-signer": { title: "Set the voucher signer", rule: "the voucher signer" },
    "add-attester": { title: "Add a score attester", rule: "who attests scores" }, "remove-attester": { title: "Remove a score attester", rule: "who attests scores" },
    "add-curator": { title: "Add a curator", rule: "who curates" }, "remove-curator": { title: "Remove a curator", rule: "who curates" },
    // A one-way latch: imports cannot be reopened.
    "seal-import": { title: "Permanently close listing imports", rule: "permanently closing listing imports" },
    approve: { title: "Approve a listing", rule: LISTINGS }, reject: { title: "Reject a listing", rule: LISTINGS }, delist: { title: "Delist a listing", rule: LISTINGS },
    restore: { title: "Restore a listing", rule: LISTINGS }, "clear-flags": { title: "Clear a listing's flags", rule: LISTINGS },
    "refund-client": { title: "Refund the client", rule: DISPUTES }, "pay-freelancer": { title: "Pay the freelancer", rule: DISPUTES },
    "add-admin": { title: "Add an admin", rule: "its admins" }, "remove-admin": { title: "Remove an admin", rule: "its admins" },
    "add-moderator": { title: "Add a moderator", rule: "its moderators" }, "remove-moderator": { title: "Remove a moderator", rule: "its moderators" },
    "add-member": { title: "Add a member", rule: "its members" }, "remove-member": { title: "Remove a member", rule: "its members" },
    "set-roles": { title: "Set a member's roles", rule: "members' roles" }, "create-text-channel": { title: "Create a channel", rule: "creating channels" },
}

/** Every operation the DAO can vote on for one application, with the category the host assigns it. */
export function policyOperations(key: ApplicationPolicyKey): { operation: string; category: WeightedCategory }[] {
    const type = (Object.keys(POLICY_FOR) as WeightedApplicationAction["type"][]).find((t) => POLICY_FOR[t] === key)!
    const schema = (applicationActions as readonly { shape: { type: { value: string }; operation: { options: readonly string[] } } }[]).find((a) => a.shape.type.value === type)!
    return schema.shape.operation.options.map((operation) => ({ operation, category: expectedCategory({ type, operation }) }))
}

/** Configured destinations bind every staged return and treasury change. */
export function applicationActionMatchesPolicy(action: WeightedApplicationAction, policies: { [K in ApplicationPolicyKey]: z.infer<(typeof applicationPolicySchemas)[K]> } & { realmPath: string }): boolean {
    const policy = policies[POLICY_FOR[action.type]]
    if (action.target !== policy.target) return false
    const op = action.operation
    // The DAO has no withdrawal path: fees sent to it would be trapped.
    if (op === "set-fee-recipient") return action.recipient !== packageAddress(policies.realmPath)
    if (op === "return-owner" || op === "return-admin" || op === "return-moderator" || op === "abort-return") return "recipient" in action && action.recipient === policy.successor
    if (op === "set-treasury" && "treasury" in policy) return action.recipient === policy.treasury
    return true
}

// ── Authority handoff ─────────────────────────────────────────────────────────

/** The realm's exported acceptance proposal of each adapter; each takes no argument. */
export const ACCEPT_FUNCS = {
    marketPolicy: "ProposeMarketAccept", reviewsPolicy: "ProposeReviewsAccept", questPolicy: "ProposeQuestAccept",
    arcadePolicy: "ProposeArcadeAccept", appstorePolicy: "ProposeAppstoreAccept", escrowPolicy: "ProposeEscrowAccept",
    badgesPolicy: "ProposeBadgesAccept", feedPolicy: "ProposeFeedAccept", channelsPolicy: "ProposeChannelsAccept",
    feedbackPolicy: "ProposeFeedbackAccept",
} as const satisfies Record<ApplicationPolicyKey, string>

/** Action type and operation the host records for each acceptance. */
export const ACCEPT_ACTIONS: Record<ApplicationPolicyKey, { type: string; operation: string }> = {
    marketPolicy: { type: "market-config", operation: "accept-admin" }, reviewsPolicy: { type: "reviews", operation: "accept-moderator" },
    questPolicy: { type: "quest", operation: "accept-owner" }, arcadePolicy: { type: "arcade", operation: "accept-owner" },
    appstorePolicy: { type: "appstore", operation: "accept-owner" }, escrowPolicy: { type: "escrow", operation: "accept-owner" },
    badgesPolicy: { type: "badges", operation: "accept-owner" }, feedPolicy: { type: "feed", operation: "accept-owner" },
    channelsPolicy: { type: "channels", operation: "accept-owner" }, feedbackPolicy: { type: "feedback", operation: "accept-owner" },
}

export function acceptAdapterFor(action: { type: string; operation?: string }): ApplicationPolicyKey | null {
    const hit = (Object.entries(ACCEPT_ACTIONS) as [ApplicationPolicyKey, { type: string; operation: string }][])
        .find(([, a]) => a.type === action.type && a.operation === action.operation)
    return hit ? hit[0] : null
}

export const APPLICATION_LABELS: Record<WeightedApplicationAction["type"], string> = {
    "market-config": "Market config", reviews: "Reviews", quest: "Quests", arcade: "Arcade", appstore: "App Store",
    escrow: "Escrow", badges: "Badges", feed: "Feed", channels: "DAO channels", feedback: "Feedback",
}

// The owner is the one when the state was frozen, not necessarily today's. Only Arcade lists addresses: its attesters.
const WHO: Record<string, string> = { owner: "The owner", dao: "The DAO", successor: "The successor", subject: "The address concerned" }
const IS: Record<string, string> = { Admin: "is an admin", Curator: "is a curator", Listed: "is an attester", Member: "is a member", Moderator: "is a moderator" }
/** An action's own parameters named for a reader (top level only: nested state is labelled word by word). */
const NAMED: Record<string, string> = { bps: "Fee (basis points)", id: "Item", contractId: "Contract", milestoneIndex: "Milestone", fee: "Fee (ugnot)", path: "Listing path", subject: WHO.subject }

/**
 * A contract field as a reader says it: "daoMember" is "The DAO is a
 * member", "ownerRoles" is "The current owner's roles", "pendingAdmin" is
 * "Pending admin". A nested field joins its parts with " · ".
 */
export function factLabel(key: string): string {
    return key.split(".").map((part, i) => {
        const who = /^(owner|dao|successor|subject)(Admin|Curator|Listed|Member|Moderator|Roles)$/.exec(part)
        if (who) return who[2] === "Roles" ? `Roles of ${WHO[who[1]].replace(/^The/, "the")}` : `${WHO[who[1]]} ${IS[who[2]]}`
        const words = (i === 0 ? NAMED[part] : undefined) ?? part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/^id$/, "ID").replace(/\bbps\b/, "fee (basis points)")
        return i === 0 ? words.charAt(0).toUpperCase() + words.slice(1) : words
    }).join(" · ")
}

/** A contract value as a reader says it; invisible and bidi characters are made visible. */
function factValue(value: unknown): string {
    if (value === null) return "(none)"
    if (value === "") return "(unset)"
    if (typeof value === "boolean") return value ? "Yes" : "No"
    return revealInvisibleFormatting(String(value))
}

/** Operation parameters worth showing, in host field order, labelled for a reader; unset values are omitted. */
export function applicationDetails(action: WeightedApplicationAction): [string, string][] {
    const skip = new Set(["type", "target", "operation", "before"])
    const out: [string, string][] = []
    for (const [key, value] of Object.entries(action)) {
        if (skip.has(key) || value === "" || value === null || (action.type === "market-config" && key === "bps" && action.operation !== "set-fee") || (action.type === "appstore" && key === "fee" && action.operation !== "set-fee") || (action.type === "reviews" && key === "id" && value === "0")) continue
        // Milestones are numbered from 1, as the frozen state lists them.
        // The contract counts milestones from 0 (a uint64 string); the frozen state lists them from 1.
        out.push([factLabel(key), key === "milestoneIndex" && typeof value === "string" ? String(BigInt(value) + 1n) : factValue(value)])
    }
    return out
}

/** Flatten the frozen pre-state into rows labelled for a reader (a nested field joins its parts). */
export function flattenBefore(value: unknown, prefix = ""): [string, string][] {
    if (value === null || typeof value !== "object") return [[factLabel(prefix), factValue(value)]]
    const rows: [string, string][] = []
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v] as const) : Object.entries(value)
    if (entries.length === 0) return [[factLabel(prefix), "(none)"]]
    for (const [key, v] of entries) rows.push(...flattenBefore(v, prefix ? `${prefix}.${key}` : key))
    return rows
}
