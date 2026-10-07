/**
 * What a memba_gov proposal does, in words, keyed by (target, action). Each
 * entry names every argument position, including the state the approval was
 * voted on and the app's tenure, so a voter reads the whole approval. A
 * proposal whose (target, action) is unknown, or whose arguments do not have
 * the expected shape, decodes to null: the window then shows it raw and
 * offers no one-click yes.
 */
import { parseArgs, type DaoauthField, type DaoauthTag } from "./daoauth"

export const GOV_PATH = "gno.land/r/samcrew/memba_gov"
export const BRIDGE_PATH = "gno.land/r/samcrew/memba_bridge_v1"

export const ROUTINE = 1, FINANCIAL = 2, CRITICAL = 3
export const CLASS_NAMES: Record<number, string> = { 1: "Routine", 2: "Financial", 3: "Critical" }

/** How a value is shown: the window formats each kind. */
export type GovValueKind = "address" | "text" | "id" | "ugnot" | "bps" | "time" | "height" | "count" | "yesno" | "hash"
export type GovRow = { label: string; value: string; kind: GovValueKind }
export type GovDecoded = { title: string; app: string | null; minClass: number; rows: GovRow[]; scope: string; refused: string | null }

type Spec = [label: string, tag: DaoauthTag, kind: GovValueKind]
type Entry = {
    title: string; minClass: number; layout: (f: DaoauthField[], app: string | null) => Spec[]
    /** The invalidation scope the bridge computes; the app when absent. */
    scope?: (f: DaoauthField[], app: string) => string
    /** Why the bridge refuses these values before consuming the approval, if it does. */
    refused?: (f: DaoauthField[]) => string | null
}

/** The ten apps the bridge governs, with the roles and features each has. */
export const BRIDGE_APPS: Record<string, { label: string; role?: string; pause?: true; treasury?: true; members?: true }> = {
    memba_market_config: { label: "Market config", treasury: true },
    escrow_v4: { label: "Escrow", pause: true },
    memba_appstore_v3: { label: "App Store", role: "curator", pause: true, treasury: true },
    memba_reviews_v2: { label: "Reviews" },
    memba_quest_attestation_v1: { label: "Quests" },
    memba_arcade_leaderboard_v1: { label: "Arcade", role: "attester", pause: true },
    gnobuilders_badges_v2: { label: "Badges", role: "admin", pause: true },
    memba_feed_v1: { label: "Feed", role: "moderator", pause: true },
    memba_dao_channels_v2: { label: "Channels", pause: true, members: true },
    memba_feedback_v2: { label: "Feedback", pause: true, members: true },
}

const fixed = (...specs: Spec[]) => () => specs
const tenure: Spec = ["App tenure (hand-overs to the bridge)", "u", "count"]

/** Bridge operations, by the part of the action after "<app>.". */
const BRIDGE: Record<string, Entry & { apps: (app: string) => boolean }> = {
    TransferAdmin: { title: "Hand the app's admin role to", minClass: CRITICAL, apps: () => true,
        layout: fixed(["New admin (accepts by its own call)", "a", "address"], ["Staged admin now (empty = none)", "s", "text"], tenure) },
    CancelTransfer: { title: "Withdraw the staged admin hand-over", minClass: FINANCIAL, apps: () => true,
        layout: fixed(["Staged admin withdrawn", "s", "text"], tenure) },
    SetPause: { title: "Set the app's pause", minClass: FINANCIAL, apps: a => !!BRIDGE_APPS[a].pause,
        layout: fixed(["Paused until (0 = unpause now)", "i", "time"], ["Paused when voted", "b", "yesno"], ["Pause episode", "u", "count"], tenure) },
    Grant: { title: "Grant the app's role to", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].role,
        layout: (_, app) => roleHolder(app) },
    Revoke: { title: "Revoke the app's role from", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].role,
        layout: (_, app) => roleHolder(app) },
    Curate: { title: "Curate an App Store listing", minClass: ROUTINE, apps: a => a === "memba_appstore_v3",
        scope: f => `memba_appstore_v3/l/${f[1]?.value}`,
        refused: f => !["approve", "reject", "delist", "restore", "clearflags"].includes(f[0].value) ? `the bridge knows no curation "${f[0].value}"`
            : (f[0].value === "reject") !== (f[2].value !== "") ? "a reason goes with reject, and only with reject" : null,
        layout: f => {
            const op = f[0]?.value
            return [["Operation", "s", "text"], ["Listing", "s", "text"], ["Reason", "s", "text"], ["Listing status when voted", "s", "text"],
                ...(op === "approve" || op === "restore" ? [["Listing content hash", "s", "hash"] as Spec] : []),
                ...(op === "clearflags" ? [["Flags cleared", "i", "count"], ["Flag keys hash", "s", "hash"]] as Spec[] : []), tenure]
        } },
    SetRegistrationFee: { title: "Set the App Store registration fee", minClass: FINANCIAL, apps: a => a === "memba_appstore_v3",
        layout: fixed(["New fee", "i", "ugnot"], ["Fee now", "i", "ugnot"], tenure) },
    SetTreasury: { title: "Send the app's fees to", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].treasury,
        layout: fixed(["New treasury", "a", "address"], ["Treasury now", "s", "text"], tenure) },
    SetFee: { title: "Set a market fee", minClass: FINANCIAL, apps: a => a === "memba_market_config",
        layout: fixed(["Lane", "s", "text"], ["New fee", "i", "bps"], ["Fee now", "i", "bps"], tenure) },
    ResolveDispute: { title: "Settle an escrow dispute", minClass: FINANCIAL, apps: a => a === "escrow_v4",
        scope: f => `escrow_v4/c/${f[0]?.value}/m/${f[1]?.value}`,
        layout: f => [["Contract", "s", "id"], ["Milestone (from 0)", "i", "count"], ["Refund the client in full", "b", "yesno"],
            ["Milestone status", "s", "text"], ["Status before the dispute", "s", "text"], ["Amount", "i", "ugnot"], ["Disputed at block", "i", "height"],
            ...(f[2]?.value === "0" ? [["Platform fee", "i", "bps"], ["Fee goes to", "s", "text"]] as Spec[] : []), tenure] },
    ProposeFeeRecipient: { title: "Stage escrow's fallback fee recipient", minClass: CRITICAL, apps: a => a === "escrow_v4",
        layout: fixed(["New recipient", "a", "address"], ["Recipient now", "s", "text"], ["Staged now", "s", "text"], tenure) },
    CancelFeeRecipient: { title: "Withdraw escrow's staged fee recipient", minClass: FINANCIAL, apps: a => a === "escrow_v4",
        layout: fixed(["Staged recipient withdrawn", "s", "text"], tenure) },
    HideReview: { scope: reviewScope, title: "Hide a review", minClass: ROUTINE, apps: a => a === "memba_reviews_v2", layout: f => moderation(f, false) },
    HideComment: { scope: reviewScope, title: "Hide a comment", minClass: ROUTINE, apps: a => a === "memba_reviews_v2", layout: f => moderation(f, false) },
    Unhide: { scope: reviewScope, title: "Show a review or comment again", minClass: ROUTINE, apps: a => a === "memba_reviews_v2", layout: f => moderation(f, true) },
    SetSigner: { title: "Rotate the quest signer key", minClass: CRITICAL, apps: a => a === "memba_quest_attestation_v1",
        refused: f => /^[0-9a-f]{64}$/.test(f[0].value) && f[0].value !== f[1].value ? null : "a new signer is 64 lowercase hex digits, other than the current one",
        layout: fixed(["New public key", "s", "hash"], ["Key now", "s", "hash"], tenure) },
    AddMember: { title: "Add a member", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].members, layout: () => membership, refused: f => rolesRefused(f[1].value) },
    RemoveMember: { title: "Remove a member", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].members, layout: () => membership },
    SetRoles: { title: "Change a member's roles", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].members, layout: () => membership, refused: f => rolesRefused(f[1].value) },
    CreateChannel: { title: "Create a channel (permanent)", minClass: CRITICAL, apps: a => !!BRIDGE_APPS[a].members,
        refused: f => ["text", "announcements", "readonly"].includes(f[2].value) && f[1].value.length >= 1 && f[1].value.length <= 200 ? null
            : "a channel type is text, announcements or readonly, and a description has 1 to 200 characters",
        layout: fixed(["Name", "s", "text"], ["Description", "s", "text"], ["Type", "s", "text"], ["Channels now", "i", "count"], tenure) },
}

const roleHolder = (app: string | null): Spec[] =>
    [["Holder", "a", "address"], ...(app === "gnobuilders_badges_v2" ? [["Badge admins now", "i", "count"] as Spec] : []), tenure]

function reviewScope(f: DaoauthField[]) { return `memba_reviews_v2/i/${f[0]?.value}` }

/** An ordered, non-empty subset of admin,dev,ops,member, as the bridge requires. */
function rolesRefused(roles: string): string | null {
    const names = ["admin", "dev", "ops", "member"]
    let next = 0
    for (const r of roles.split(",")) {
        while (next < names.length && names[next] !== r) next++
        if (next++ === names.length) return "roles are an ordered subset of admin,dev,ops,member"
    }
    return null
}

const membership: Spec[] = [["Member", "a", "address"], ["Roles", "s", "text"], ["Membership revision", "u", "count"], ["Roles now", "s", "text"], tenure]

function moderation(_: DaoauthField[], unhide: boolean): Spec[] {
    return [["Item", "u", "id"], ["Is a review", "b", "yesno"], ["Hidden when voted", "b", "yesno"], ["Deleted", "b", "yesno"],
        ["Author", "a", "address"], ["Posted at block", "i", "height"],
        ...(unhide ? [["Text hash", "s", "hash"], ["Edited at block", "i", "height"], ["Flagged when voted (unhide dismisses flags)", "b", "yesno"]] as Spec[] : []), tenure]
}

/** memba_gov's own roster actions; the core fixes their class. */
const CORE: Record<string, Entry> = {
    AddMember: { title: "Invite a new member", minClass: CRITICAL, layout: fixed(["Person", "s", "id"], ["Key", "a", "address"], ["Weight", "u", "count"]) },
    RemoveMember: { title: "Remove a member", minClass: CRITICAL, layout: fixed(["Person", "s", "id"]) },
    SetWeight: { title: "Change a member's weight", minClass: CRITICAL, layout: fixed(["Person", "s", "id"], ["New weight", "u", "count"]) },
    Recover: { title: "Recover a member's key", minClass: CRITICAL, layout: fixed(["Person", "s", "id"], ["New key (joins by its own call)", "a", "address"]) },
    RemoveInactive: { title: "Remove an inactive member", minClass: ROUTINE, layout: fixed(["Person", "s", "id"]) },
    Uninvite: { title: "Revoke an invitation", minClass: FINANCIAL, layout: fixed(["Person", "s", "id"]) },
}

/** Decodes a proposal's action, or null when it must be shown raw. */
export function decodeGovAction(target: string, action: string, args: string): GovDecoded | null {
    let entry: Entry | undefined, app: string | null = null
    if (target === GOV_PATH) entry = Object.hasOwn(CORE, action) ? CORE[action] : undefined
    else if (target === BRIDGE_PATH) {
        const dot = action.indexOf(".")
        const candidate = action.slice(0, dot), op = action.slice(dot + 1)
        if (dot > 0 && Object.hasOwn(BRIDGE_APPS, candidate) && Object.hasOwn(BRIDGE, op) && BRIDGE[op].apps(candidate)) {
            entry = BRIDGE[op]; app = candidate
        }
    }
    if (!entry) return null
    let fields: DaoauthField[]
    try { fields = parseArgs(args) } catch { return null }
    const specs = entry.layout(fields, app)
    if (specs.length !== fields.length || specs.some(([, tag], i) => fields[i].tag !== tag)) return null
    const title = app ? `${BRIDGE_APPS[app].label} · ${entry.title}` : entry.title
    const scope = app ? entry.scope?.(fields, app) ?? app : ""
    return { title, app, minClass: entry.minClass, rows: specs.map(([label, , kind], i) => ({ label, value: fields[i].value, kind })), scope, refused: entry.refused?.(fields) ?? null }
}

/** Why a decoded proposal can never execute, or null: Consume needs at least its class and the exact scope. */
export function govNeverRuns(p: { class: number; scope: string }, d: GovDecoded): string | null {
    if (p.class < d.minClass) return `It is filed as ${CLASS_NAMES[p.class]}, below the ${CLASS_NAMES[d.minClass]} class this action needs.`
    if (p.scope !== d.scope) return `Its scope "${p.scope}" is not the "${d.scope}" the ${d.app ? "bridge" : "roster"} checks.`
    if (d.refused) return `The bridge refuses it: ${d.refused}.`
    return null
}
