/**
 * Strict reads of the curation realm: who curates the marketplace and what was
 * decided about a collection (applications, feature slots, temporary holds,
 * verification, appeals). The realm blocks nothing: a screen reads these records
 * and decides what to show, so an unreadable, malformed or self-contradicting
 * answer throws and is never taken for "no record". Public text is not on chain:
 * a statement or a reason is a (hash, CID) pair, and lib/nft/evidence fetches and
 * checks what it points to. The realm is not published on any network yet.
 *
 * @module lib/nft/curation
 */
import { GNO_RPC_URL } from "../config"
import { isValidGnoAddressChecksum } from "../dao/address"
import { parseQevalJSON, queryEval } from "../dao/shared"
import { address, bool, cid, collectionId, decimal, hash, list, oneOf, record } from "./parse"

export const NFT_CURATION_PATH = "gno.land/r/samcrew/launchpad/curation/v1"

const APPLICATION_STATUSES = ["submitted", "changes_requested", "recommended", "declined"] as const
const APPEAL_SUBJECTS = ["application", "hold", "verification", "feature"] as const
/** The realm's seat limit, a constant of curation/v1. */
const MAX_SEATS = 5

export type CurationApplicationStatus = (typeof APPLICATION_STATUSES)[number]
export type CurationAppealSubject = (typeof APPEAL_SUBJECTS)[number]

export interface CurationState {
    admin: string
    /** Empty unless an admin handoff is waiting to be accepted. */
    pendingAdmin: string
    activeManagers: number
    maxSeats: number
}

export interface CurationManager {
    account: string
    /** A public label: it grants nothing. */
    lead: boolean
    /** The seat is active strictly before this time. */
    until: bigint
}

/** A founder's request for review and the latest decision on it. */
export interface CurationApplication {
    collection: string
    founder: string
    statementHash: string
    statementCID: string
    /** Counts the founder's filings, from 1. */
    revision: bigint
    status: CurationApplicationStatus
    /** Empty, like the reason, while the latest filing awaits review. */
    reviewer: string
    reasonHash: string
    reasonCID: string
    updatedAt: bigint
}

/** What an account is to a collection right now. Public data, not a permission. */
export interface CurationAccess {
    collection: string
    account: string
    founder: boolean
    manager: boolean
    /** True for the founder too: a conflicted manager cannot act on the collection. */
    conflicted: boolean
}

export interface CurationVerification {
    verified: boolean
    reasonHash: string
    reasonCID: string
    updatedAt: bigint
}

export interface CurationFeature {
    proposer: string
    /** Empty until a second manager approves: the slot features nothing before that. */
    approver: string
    reasonHash: string
    reasonCID: string
    until: bigint
}

export interface CurationHold {
    actor: string
    /** Empty until a second manager confirms. */
    confirmer: string
    /** True once the admin set the term and its reason. */
    extended: boolean
    reasonHash: string
    reasonCID: string
    until: bigint
}

export interface CurationAppeal {
    collection: string
    subject: CurationAppealSubject
    statementHash: string
    statementCID: string
    filedAt: bigint
    open: boolean
    /** The admin's answer. False, with an empty reason and a zero time, while the appeal is open. */
    upheld: boolean
    reasonHash: string
    reasonCID: string
    resolvedAt: bigint
}

/** A collection's editorial record: what may be shown now, then the records behind it. */
export interface CurationRecord {
    collection: string
    verified: boolean
    featured: boolean
    hidden: boolean
    verification: CurationVerification | null
    feature: CurationFeature | null
    hold: CurationHold | null
    /** The latest appeal on each subject. */
    appeals: Record<CurationAppealSubject, CurationAppeal | null>
}

/** One row of the feature list: a slot on record, and whether it features its collection right now. */
export interface CurationFeatureSlot {
    collection: string
    featured: boolean
    until: bigint
}

const STATE_KEYS = ["admin", "pendingAdmin", "activeManagers", "maxSeats"] as const
const MANAGER_KEYS = ["account", "lead", "until"] as const
const APPLICATION_KEYS = [
    "collection", "founder", "statementHash", "statementCID", "revision", "status", "reviewer", "reasonHash", "reasonCID", "updatedAt",
] as const
const ACCESS_KEYS = ["collection", "account", "founder", "manager", "conflicted"] as const
const RECORD_KEYS = ["collection", "verified", "featured", "hidden", "verification", "feature", "hold", "appeals"] as const
const VERIFICATION_KEYS = ["verified", "reasonHash", "reasonCID", "updatedAt"] as const
const FEATURE_KEYS = ["proposer", "approver", "reasonHash", "reasonCID", "until"] as const
const HOLD_KEYS = ["actor", "confirmer", "extended", "reasonHash", "reasonCID", "until"] as const
const APPEAL_KEYS = [
    "collection", "subject", "statementHash", "statementCID", "filedAt", "open", "upheld", "reasonHash", "reasonCID", "resolvedAt",
] as const
const SLOT_KEYS = ["collection", "featured", "until"] as const

/** Seat counts are the realm's only bare JSON numbers; every int64 is a decimal string. */
function count(value: unknown, what: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${what}`)
    return value
}

/** A role the realm leaves empty until someone takes it. */
function optionalAddress(value: unknown, what: string): string {
    return value === "" ? "" : address(value, what)
}

/**
 * A pointer to public text: the SHA-256 of its exact bytes and the CID it is
 * fetched from. Where the realm has recorded none yet, both halves are empty.
 */
function commitment(hashValue: unknown, cidValue: unknown, what: string, recorded = true): [string, string] {
    if (recorded) return [hash(hashValue, `${what} hash`), cid(cidValue, `${what} CID`)]
    if (hashValue !== "" || cidValue !== "") throw new Error(`Inconsistent ${what}`)
    return ["", ""]
}

function parseManager(value: unknown): CurationManager {
    const row = record(value, "manager", MANAGER_KEYS)
    return { account: address(row.account, "manager account"), lead: bool(row.lead, "lead"), until: decimal(row.until, "seat term") }
}

function parseApplication(value: unknown): CurationApplication {
    const row = record(value, "application", APPLICATION_KEYS)
    const status = oneOf(row.status, "application status", APPLICATION_STATUSES)
    // Each filing resets the review: only a reviewed application names a reviewer and carries a reason.
    const reviewed = status !== "submitted"
    if (!reviewed && row.reviewer !== "") throw new Error("Inconsistent application review")
    const [statementHash, statementCID] = commitment(row.statementHash, row.statementCID, "statement")
    const [reasonHash, reasonCID] = commitment(row.reasonHash, row.reasonCID, "review reason", reviewed)
    const revision = decimal(row.revision, "revision")
    if (revision < 1n) throw new Error("Invalid revision")
    return {
        collection: collectionId(row.collection),
        founder: address(row.founder, "founder"),
        statementHash,
        statementCID,
        revision,
        status,
        reviewer: reviewed ? address(row.reviewer, "reviewer") : "",
        reasonHash,
        reasonCID,
        updatedAt: decimal(row.updatedAt, "update time"),
    }
}

function parseVerification(value: unknown): CurationVerification {
    const row = record(value, "verification", VERIFICATION_KEYS)
    const [reasonHash, reasonCID] = commitment(row.reasonHash, row.reasonCID, "verification reason")
    return { verified: bool(row.verified, "verified"), reasonHash, reasonCID, updatedAt: decimal(row.updatedAt, "update time") }
}

function parseFeature(value: unknown): CurationFeature {
    const row = record(value, "feature", FEATURE_KEYS)
    const proposer = address(row.proposer, "feature proposer")
    const approver = optionalAddress(row.approver, "feature approver")
    // The two-manager rule: nobody approves its own proposal.
    if (approver === proposer) throw new Error("Inconsistent feature")
    const [reasonHash, reasonCID] = commitment(row.reasonHash, row.reasonCID, "feature reason")
    return { proposer, approver, reasonHash, reasonCID, until: decimal(row.until, "feature term") }
}

function parseHold(value: unknown): CurationHold {
    const row = record(value, "hold", HOLD_KEYS)
    const actor = address(row.actor, "hold actor")
    const confirmer = optionalAddress(row.confirmer, "hold confirmer")
    if (confirmer === actor) throw new Error("Inconsistent hold")
    const [reasonHash, reasonCID] = commitment(row.reasonHash, row.reasonCID, "hold reason")
    return { actor, confirmer, extended: bool(row.extended, "extended"), reasonHash, reasonCID, until: decimal(row.until, "hold term") }
}

function parseAppeal(value: unknown): CurationAppeal {
    const row = record(value, "appeal", APPEAL_KEYS)
    const open = bool(row.open, "appeal open")
    const upheld = bool(row.upheld, "appeal upheld")
    const filedAt = decimal(row.filedAt, "appeal filing time")
    const resolvedAt = decimal(row.resolvedAt, "appeal resolution time")
    const [statementHash, statementCID] = commitment(row.statementHash, row.statementCID, "appeal statement")
    const [reasonHash, reasonCID] = commitment(row.reasonHash, row.reasonCID, "appeal reason", !open)
    // An open appeal has no answer yet; a resolved one was answered no earlier than it was filed.
    if (open ? upheld || resolvedAt !== 0n : resolvedAt < filedAt) throw new Error("Inconsistent appeal resolution")
    return {
        collection: collectionId(row.collection),
        subject: oneOf(row.subject, "appeal subject", APPEAL_SUBJECTS),
        statementHash,
        statementCID,
        filedAt,
        open,
        upheld,
        reasonHash,
        reasonCID,
        resolvedAt,
    }
}

function parseRecord(value: unknown, collection: string): CurationRecord {
    const row = record(value, "curation record", RECORD_KEYS)
    if (row.collection !== collection) throw new Error("Curation record does not match the request")
    const verified = bool(row.verified, "verified")
    const featured = bool(row.featured, "featured")
    const hidden = bool(row.hidden, "hidden")
    const verification = row.verification === null ? null : parseVerification(row.verification)
    const feature = row.feature === null ? null : parseFeature(row.feature)
    const hold = row.hold === null ? null : parseHold(row.hold)
    // What may be shown follows from the records behind it: no flag stands without its record.
    if (verified !== (verification !== null && verification.verified)) throw new Error("Inconsistent verification")
    // A hidden collection is never featured, and a slot features nothing before its approval.
    if (featured && (feature === null || feature.approver === "" || hidden)) throw new Error("Inconsistent feature")
    if (hidden && hold === null) throw new Error("Inconsistent hold")

    const latest = record(row.appeals, "appeals", APPEAL_SUBJECTS)
    const appeal = (subject: CurationAppealSubject) => {
        if (latest[subject] === null) return null
        const parsed = parseAppeal(latest[subject])
        if (parsed.collection !== collection || parsed.subject !== subject) throw new Error("Appeal does not match the request")
        return parsed
    }
    return {
        collection,
        verified,
        featured,
        hidden,
        verification,
        feature,
        hold,
        appeals: { application: appeal("application"), hold: appeal("hold"), verification: appeal("verification"), feature: appeal("feature") },
    }
}

/** A missing answer is an error ("could not read"), never an empty result. */
async function query(expr: string, what: string): Promise<string> {
    // The query picks a node of the session network and fails over by itself; the URL does not choose one.
    const raw = await queryEval(GNO_RPC_URL, NFT_CURATION_PATH, expr, true)
    if (raw === null) throw new Error(`Could not read ${what}`)
    return raw
}

async function read(expr: string, what: string): Promise<unknown> {
    return parseQevalJSON(await query(expr, what))
}

/** One zero-based page of 1 to 50 rows. The page is checked before anything is sent. */
async function readPage<T>(view: string, page: number, size: number, what: string, parse: (row: unknown) => T): Promise<T[]> {
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 50) throw new Error(`Invalid ${what} page`)
    const rows = list(await read(`${view}(${page}, ${size})`, `${what}s`), `${what} list`)
    if (rows.length > size) throw new Error(`Invalid ${what} list`)
    return rows.map(parse)
}

export async function getCurationState(): Promise<CurationState> {
    const row = record(await read("StateJSON()", "curation state"), "curation state", STATE_KEYS)
    const state = {
        admin: address(row.admin, "admin"),
        pendingAdmin: optionalAddress(row.pendingAdmin, "pending admin"),
        activeManagers: count(row.activeManagers, "active managers"),
        maxSeats: count(row.maxSeats, "seat limit"),
    }
    // A handoff is never proposed to the admin itself, and no more seats are active than exist.
    if (state.pendingAdmin === state.admin || state.maxSeats !== MAX_SEATS || state.activeManagers > state.maxSeats) {
        throw new Error("Inconsistent curation state")
    }
    return state
}

/** The active seats. An empty list is a real answer: the realm starts with no manager. */
export async function getCurationManagers(): Promise<CurationManager[]> {
    const managers = list(await read("ManagersJSON()", "managers"), "manager list").map(parseManager)
    // Seats come ordered by account, so no account is seated twice.
    if (managers.length > MAX_SEATS || managers.some((manager, index) => index > 0 && manager.account <= managers[index - 1].account)) {
        throw new Error("Inconsistent manager list")
    }
    return managers
}

/** Null when nobody applied for the collection. */
export async function getApplication(collection: string): Promise<CurationApplication | null> {
    const raw = await query(`ApplicationJSON("${collectionId(collection)}")`, "application")
    // Only the realm's literal null means "no application": an answer that cannot be decoded parses to null as well.
    if (/^\(\s*"null"\s+string\s*\)\s*$/.test(raw)) return null
    const application = parseApplication(parseQevalJSON(raw))
    if (application.collection !== collection) throw new Error("Application does not match the request")
    return application
}

/** Applications in order of first filing. */
export async function listApplications(page = 0, size = 20): Promise<CurationApplication[]> {
    const applications = await readPage("ApplicationsJSON", page, size, "application", parseApplication)
    if (new Set(applications.map((application) => application.collection)).size !== applications.length) throw new Error("Duplicate application")
    return applications
}

export async function getCurationAccess(collection: string, who: string): Promise<CurationAccess> {
    // The realm refuses an address whose checksum is wrong, so none is sent.
    if (!isValidGnoAddressChecksum(who)) throw new Error("Invalid account")
    const row = record(await read(`AccessJSON("${collectionId(collection)}", "${who}")`, "curation access"), "curation access", ACCESS_KEYS)
    if (row.collection !== collection || row.account !== who) throw new Error("Curation access does not match the request")
    const access = { collection, account: who, founder: bool(row.founder, "founder"), manager: bool(row.manager, "manager"), conflicted: bool(row.conflicted, "conflicted") }
    // The creator of a collection is always in conflict on it.
    if (access.founder && !access.conflicted) throw new Error("Inconsistent curation access")
    return access
}

export async function getCurationRecord(collection: string): Promise<CurationRecord> {
    return parseRecord(await read(`CollectionJSON("${collectionId(collection)}")`, "curation record"), collection)
}

/** Open appeals in filing order. */
export async function listOpenAppeals(page = 0, size = 20): Promise<CurationAppeal[]> {
    const appeals = await readPage("AppealsJSON", page, size, "appeal", parseAppeal)
    if (appeals.some((appeal) => !appeal.open)) throw new Error("Resolved appeal in the open list")
    // A collection has at most one open appeal per subject.
    if (new Set(appeals.map((appeal) => `${appeal.collection}/${appeal.subject}`)).size !== appeals.length) throw new Error("Duplicate appeal")
    return appeals
}

/** Every collection with a feature slot on record, in ID text order (`C10` before `C2`). */
export async function listFeatureSlots(page = 0, size = 20): Promise<CurationFeatureSlot[]> {
    const slots = await readPage("FeaturesJSON", page, size, "feature slot", (value) => {
        const row = record(value, "feature slot", SLOT_KEYS)
        return { collection: collectionId(row.collection), featured: bool(row.featured, "featured"), until: decimal(row.until, "feature term") }
    })
    if (slots.some((slot, index) => index > 0 && slot.collection <= slots[index - 1].collection)) throw new Error("Inconsistent feature slot list")
    return slots
}
