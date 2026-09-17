/**
 * DAO Template Generator — generates the Gno realm a user deploys for a new DAO.
 *
 * Template version `memba-dao/2` (see `templates/dao/v2/realm.ts`):
 * - members with bounded voting power and role labels (roles grant nothing);
 * - every membership, role or archive change is a proposal members vote on;
 * - time-based voting period, execution delay and execution window;
 * - YES / NO / ABSTAIN with overflow-safe threshold and quorum math;
 * - bounded, paginated JSON reads and an escaped Render.
 *
 * Every value is validated here first and the generator throws on anything
 * invalid: a deployed realm is immutable, so nothing may be silently fixed up.
 */

import type { AminoMsg } from "./grc20"
import { GNO_BECH32_HRP } from "./config"
import { isValidGnoAddress, isValidIdentifier, validateRealmPath, requireInt, requireRealmPath } from "./templates/sanitizer"
import { buildDeployMsg } from "./templates/prologue"
import { isChecksummedAddress } from "./templates/dao/v2/bech32"
import { REALM_LIMITS, renderRealmV2 } from "./templates/dao/v2/realm"
export { validateRealmPath }
export { TEMPLATE_VERSION as DAO_TEMPLATE_VERSION, API_VERSION as DAO_API_VERSION, REALM_LIMITS as DAO_REALM_LIMITS } from "./templates/dao/v2/realm"

// ── Limits ────────────────────────────────────────────────────

export const DAO_NAME_MAX = 64
export const DAO_DESCRIPTION_MAX = 1000
export const DAO_MIN_THRESHOLD = 51
const MAX_LABELS = 16

// ── Wizard step validation (pure, testable) ───────────────────

export interface DAOStepData {
    name: string
    realmPath: string
    // power optional: some callers only step-validate address/roles; when
    // present it is range-checked before the fail-closed codegen throw.
    members: { address: string; roles: string[]; power?: number }[]
    threshold: number
    quorum: number
}

// Gno package declarations use identifier tokens, not arbitrary path segments.
const RESERVED_PACKAGE_NAMES = new Set("break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var".split(" "))
function daoPackageError(path: string): string | null {
    const name = path.split("/").pop() ?? ""
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || RESERVED_PACKAGE_NAMES.has(name)) {
        return "Realm name must be a valid, non-reserved Gno package identifier"
    }
    return null
}

/** Lone UTF-16 surrogates cannot be written into Gno source. */
function hasLoneSurrogate(s: string): boolean {
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
}

/** C0/C1 controls, DEL and the Unicode line/paragraph separators. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/

/** Unicode format characters: byte-order mark, zero-width and bidi controls. They are invisible, and a raw byte-order mark does not parse in Gno source. */
const FORMAT_CHARS = /\p{Cf}/u

function nameError(name: string): string | null {
    if (typeof name !== "string" || !name.trim()) return "DAO name is required"
    if (name.trim().length < 3) return "DAO name must be at least 3 characters"
    if (name.length > DAO_NAME_MAX) return `DAO name must be at most ${DAO_NAME_MAX} characters`
    if (hasLoneSurrogate(name) || CONTROL_CHARS.test(name) || FORMAT_CHARS.test(name)) return "DAO name contains characters that are not allowed"
    return null
}

function descriptionError(description: string): string | null {
    if (typeof description !== "string") return "DAO description must be text"
    if (description.length > DAO_DESCRIPTION_MAX) return `DAO description must be at most ${DAO_DESCRIPTION_MAX} characters`
    if (hasLoneSurrogate(description) || CONTROL_CHARS_EXCEPT_NEWLINE.test(description) || FORMAT_CHARS.test(description)) return "DAO description contains characters that are not allowed"
    return null
}

/** True when addr is a well-formed, checksummed address on the configured network. */
export function isDeployableMemberAddress(addr: string): boolean {
    return isValidGnoAddress(addr) && isChecksummedAddress(addr, GNO_BECH32_HRP)
}

function daoMemberError(members: DAOStepData["members"]): string | null {
    if (members.length === 0) return "At least one member with a valid g1 address is required"
    if (members.length > REALM_LIMITS.maxMembers) return `A DAO can have at most ${REALM_LIMITS.maxMembers} members`
    if (members.some(m => !isValidGnoAddress(m.address))) return "Every member must have a valid g1 address (40 characters)"
    if (members.some(m => !isChecksummedAddress(m.address, GNO_BECH32_HRP))) return "A member address has a typo (its checksum does not match)"
    if (new Set(members.map(m => m.address)).size !== members.length) return "Duplicate member addresses are not allowed"
    if (members.some(m => m.power !== undefined && (!Number.isSafeInteger(m.power) || m.power < 1 || m.power > REALM_LIMITS.maxPower))) {
        return "Member voting power must be a whole number between 1 and 1,000,000,000"
    }
    return null
}

function requireLabels(label: string, values: string[]): void {
    if (!Array.isArray(values) || values.length === 0 || values.some(value => !isValidIdentifier(value))) {
        throw new Error(`Invalid ${label}: provide at least one valid identifier`)
    }
    if (values.length > MAX_LABELS) throw new Error(`Too many ${label}: at most ${MAX_LABELS}`)
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} are not allowed`)
}

/**
 * Validate a single CreateDAO wizard step's data. Returns an error string for
 * the first problem found, or null if the step is valid. Pure (no component
 * state) so it can guard both the "Next" button and direct step navigation.
 */
export function daoStepError(step: number, d: DAOStepData): string | null {
    if (step === 1) {
        const err = nameError(d.name)
        if (err) return err
        if (!d.realmPath.trim()) return "Realm path is required"
        const pathErr = validateRealmPath(d.realmPath)
        if (pathErr) return pathErr
        const packageErr = daoPackageError(d.realmPath)
        if (packageErr) return packageErr
    }
    if (step === 2) {
        // An untouched extra row is not a member. Nonempty invalid rows must
        // never disappear between the wizard review and generated deployment.
        return daoMemberError(d.members.filter(m => m.address !== ""))
    }
    if (step === 3) {
        // NaN (e.g. an emptied number input) fails BOTH range comparisons —
        // check integer-ness explicitly or it sails through to codegen.
        if (!Number.isInteger(d.threshold) || d.threshold < DAO_MIN_THRESHOLD || d.threshold > 100) return "Threshold must be between 51 and 100"
        if (!Number.isInteger(d.quorum) || d.quorum < 0 || d.quorum > 100) return "Quorum must be between 0 and 100"
    }
    return null
}

// ── Types ─────────────────────────────────────────────────────

export interface DAOCreationConfig {
    /** Human-readable DAO name (3–64 characters, single line). */
    name: string
    /** Short description (at most 1000 characters). */
    description: string
    /** Gno realm path (e.g., gno.land/r/<address>/mydao). */
    realmPath: string
    /** Founding members: power 1..1e9, roles are labels only. */
    members: { address: string; power: number; roles: string[] }[]
    /** Share of ALL voting power that must vote YES, 51..100. */
    threshold: number
    /** Role labels available in this DAO. Roles grant no powers. */
    roles: string[]
    /** Share of all voting power that must take part (YES, NO or ABSTAIN), 0..100. */
    quorum: number
    /** Categories allowed for text proposals. */
    proposalCategories: string[]
    /** How long a proposal accepts votes, 1 h .. 30 d. */
    votingPeriodSeconds: number
    /** Wait between acceptance and the earliest execution, 0 .. 7 d. */
    executionDelaySeconds: number
    /** How long an accepted proposal stays executable after the delay, 1 d .. 30 d. */
    executionWindowSeconds: number
}

// ── Presets ────────────────────────────────────────────────────

export interface DAOPreset {
    id: string
    name: string
    icon: string
    description: string
    roles: string[]
    threshold: number
    quorum: number
    categories: string[]
    votingPeriodSeconds: number
    executionDelaySeconds: number
    executionWindowSeconds: number
}

const HOUR = 3600
const DAY = 86400

export const DAO_PRESETS: DAOPreset[] = [
    {
        id: "basic",
        name: "Basic",
        icon: "🏠",
        description: "Simple DAO with member roles and no quorum. Votes last 3 days.",
        roles: ["admin", "member"],
        threshold: 51,
        quorum: 0,
        categories: ["governance"],
        votingPeriodSeconds: 3 * DAY,
        executionDelaySeconds: 1 * HOUR,
        executionWindowSeconds: 7 * DAY,
    },
    {
        id: "team",
        name: "Team",
        icon: "👥",
        description: "Team DAO with admin, dev and member labels, a 33% quorum and 2-day votes.",
        roles: ["admin", "dev", "member"],
        threshold: 51,
        quorum: 33,
        categories: ["governance", "membership"],
        votingPeriodSeconds: 2 * DAY,
        executionDelaySeconds: 1 * HOUR,
        executionWindowSeconds: 7 * DAY,
    },
    {
        id: "enterprise",
        name: "Enterprise",
        icon: "🏢",
        description: "Larger organisation: 66% threshold, 50% quorum, week-long votes and a 24-hour delay.",
        roles: ["admin", "dev", "finance", "ops", "member"],
        threshold: 66,
        quorum: 50,
        categories: ["governance", "membership", "operations"],
        votingPeriodSeconds: 7 * DAY,
        executionDelaySeconds: 24 * HOUR,
        executionWindowSeconds: 14 * DAY,
    },
]

// Re-export for backward compatibility
export { isValidGnoAddress } from "./templates/sanitizer"

// ── Code Generator ────────────────────────────────────────────

/**
 * Generate Gno realm source code from a DAO configuration.
 * Returns a self-contained .gno file as a string. Throws on any invalid input.
 */
export function generateDAOCode(config: DAOCreationConfig): string {
    requireRealmPath("realmPath", config.realmPath)
    const packageError = daoPackageError(config.realmPath)
    if (packageError) throw new Error(packageError)
    const nameErr = nameError(config.name)
    if (nameErr) throw new Error(nameErr)
    const descErr = descriptionError(config.description)
    if (descErr) throw new Error(descErr)

    requireInt("threshold", config.threshold, DAO_MIN_THRESHOLD, 100)
    requireInt("quorum", config.quorum, 0, 100)
    requireInt("votingPeriodSeconds", config.votingPeriodSeconds, REALM_LIMITS.minVotingPeriod, REALM_LIMITS.maxVotingPeriod)
    requireInt("executionDelaySeconds", config.executionDelaySeconds, 0, REALM_LIMITS.maxExecutionDelay)
    requireInt("executionWindowSeconds", config.executionWindowSeconds, REALM_LIMITS.minExecutionWindow, REALM_LIMITS.maxExecutionWindow)

    if (!Array.isArray(config.members)) throw new Error("Invalid members")
    const memberError = daoMemberError(config.members)
    if (memberError) throw new Error(memberError)
    requireLabels("roles", config.roles)
    requireLabels("proposal categories", config.proposalCategories)
    for (const member of config.members) {
        requireInt("member power", member.power, 1, REALM_LIMITS.maxPower)
        if (member.roles.some(role => !config.roles.includes(role))) throw new Error("Member roles must be declared in available roles")
        if (new Set(member.roles).size !== member.roles.length) throw new Error("Duplicate member roles are not allowed")
    }

    // Preserve the reviewed configuration exactly: no filtering or reordering
    // that could change the founding roster or the voting denominator.
    return renderRealmV2({
        pkgName: config.realmPath.split("/").pop() as string,
        name: config.name,
        description: config.description,
        threshold: config.threshold,
        quorum: config.quorum,
        votingPeriodSeconds: config.votingPeriodSeconds,
        executionDelaySeconds: config.executionDelaySeconds,
        executionWindowSeconds: config.executionWindowSeconds,
        categories: config.proposalCategories,
        roles: config.roles,
        members: config.members,
    })
}

// ── MsgAddPackage Builder ─────────────────────────────────

/**
 * Build a MsgAddPackage Amino message for Adena DoContract.
 * Deploys the generated Gno realm code to the specified path.
 * @deprecated Use `buildDeployMsg` from `templates/prologue` directly.
 */
export function buildDeployDAOMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
    deposit: string = "",
): AminoMsg {
    return buildDeployMsg(callerAddress, realmPath, code, deposit) as AminoMsg
}
