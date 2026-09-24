/**
 * The Create DAO wizard's rules (mockup v4 FLOWS.dao), on the classic page's
 * machinery (pages/CreateDAO.tsx): the same step validation (daoStepError),
 * presets, realm path, code generator, deposit cap and gas budget. Pure, so it
 * can be tested; the draft is a small OS draft kept in this browser.
 *
 * @module os/daos/createDao
 */
import { ACTIVE_NETWORK_KEY, GNO_CHAIN_ID, NETWORKS } from "../../lib/config"
import { DAO_DESCRIPTION_MAX, DAO_PRESETS, daoStepError, membersWhoCanPassAlone, type DAOCreationConfig, type DAOPreset } from "../../lib/daoTemplate"
import type { DepositInput } from "../../lib/templates/dao/v2/deposit"
import { parsePower } from "./proposal"

export const DAO_STEPS = ["Basics", "Members", "Rules", "Extras", "Review"] as const

/** The mockup's category choices, plus any the chosen preset brings. */
const BASE_CATEGORIES = ["governance", "membership", "operations"] as const

export interface DaoMemberRow { address: string; powerText: string; role: string }

export interface DaoDraft {
    name: string
    description: string
    preset: string
    members: DaoMemberRow[]
    threshold: number
    quorum: number
    categories: string[]
    /** Target design (D19): shown, never deployed. */
    treasury: boolean
}

export function presetById(id: string): DAOPreset {
    return DAO_PRESETS.find((p) => p.id === id) ?? DAO_PRESETS[0]
}

/** A new draft on the Team preset (the mockup's default), with the connected wallet as the first admin. */
export function emptyDaoDraft(wallet: string): DaoDraft {
    const p = presetById("team")
    return {
        name: "", description: "", preset: p.id,
        members: [{ address: wallet, powerText: "1", role: p.roles.includes("admin") ? "admin" : p.roles[0] }],
        threshold: p.threshold, quorum: p.quorum, categories: [...p.categories], treasury: false,
    }
}

/** As the classic applyPreset: rules and labels from the preset, the first member admin, the others member. */
export function applyPreset(d: DaoDraft, id: string): DaoDraft {
    const p = presetById(id)
    const role = (i: number) => (i === 0 ? "admin" : "member")
    return {
        ...d, preset: p.id, threshold: p.threshold, quorum: p.quorum, categories: [...p.categories],
        members: d.members.map((m, i) => ({ ...m, role: p.roles.includes(role(i)) ? role(i) : p.roles[0] })),
    }
}

export function categoryChoices(d: DaoDraft): string[] {
    return [...new Set([...BASE_CATEGORIES, ...presetById(d.preset).categories])]
}

/**
 * The realm name the classic page fills in from the DAO name (CreateDAO.tsx
 * autoFillPath), made a valid package identifier when the name starts with a
 * digit.
 */
export function slugForName(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 20) || "mydao"
    return /^[0-9]/.test(base) ? `dao_${base}`.slice(0, 20) : base
}

export function realmPathFor(wallet: string, name: string): string {
    return `gno.land/r/${wallet}/${slugForName(name)}`
}

/** Rows with an address, as the generator takes them. An unreadable power stays NaN so validation reports it. */
export function draftMembers(d: DaoDraft): DAOCreationConfig["members"] {
    return d.members
        .map((m) => ({ address: m.address.trim(), power: parsePower(m.powerText) ?? Number.NaN, roles: [m.role] }))
        .filter((m) => m.address !== "")
}

/** The first problem on a step (0 Basics, 1 Members, 2 Rules), or null. */
export function daoDraftError(d: DaoDraft, wallet: string, step: number): string | null {
    const data = { name: d.name, realmPath: realmPathFor(wallet, d.name), members: draftMembers(d), threshold: d.threshold, quorum: d.quorum }
    if (step === 0) {
        if (d.description.length > DAO_DESCRIPTION_MAX) return `DAO description must be at most ${DAO_DESCRIPTION_MAX} characters`
        return daoStepError(1, data)
    }
    if (step === 1) return daoStepError(2, data)
    if (step === 2) return d.categories.length === 0 ? "Keep at least one proposal category" : daoStepError(3, data)
    return null
}

/** The first step with a problem, or null when every step is valid. */
export function firstInvalidStep(d: DaoDraft, wallet: string): number | null {
    for (const step of [0, 1, 2]) if (daoDraftError(d, wallet, step)) return step
    return null
}

/** The exact configuration the generator receives (as the classic buildConfig). */
export function daoConfig(d: DaoDraft, wallet: string): DAOCreationConfig {
    const p = presetById(d.preset)
    return {
        name: d.name, description: d.description, realmPath: realmPathFor(wallet, d.name),
        threshold: d.threshold, quorum: d.quorum, proposalCategories: d.categories, roles: p.roles,
        members: draftMembers(d),
        votingPeriodSeconds: p.votingPeriodSeconds, executionDelaySeconds: p.executionDelaySeconds, executionWindowSeconds: p.executionWindowSeconds,
    }
}

export function depositInputFor(d: DaoDraft): DepositInput {
    return { name: d.name, description: d.description, roles: presetById(d.preset).roles, proposalCategories: d.categories, members: draftMembers(d) }
}

export function soloMembers(d: DaoDraft): string[] {
    return membersWhoCanPassAlone(draftMembers(d), d.threshold, d.quorum)
}

export function totalPower(d: DaoDraft): number {
    return draftMembers(d).reduce((sum, m) => sum + (Number.isSafeInteger(m.power) ? m.power : 0), 0)
}

/** "3 days", "24 hours". */
export function formatSeconds(s: number): string {
    if (s % 86_400 === 0) return `${s / 86_400} day${s === 86_400 ? "" : "s"}`
    return `${Math.round(s / 3600)} hour${s === 3600 ? "" : "s"}`
}

/** What this network offers for user-created DAOs (as the classic page). */
export function userDaoCapabilities() {
    const network = NETWORKS[ACTIVE_NETWORK_KEY]
    return {
        label: network?.label ?? GNO_CHAIN_ID,
        create: network?.userDaos?.create === true,
    }
}

// ── The draft, kept in this browser per network and wallet ──────────────────

const draftKey = (chainId: string, wallet: string) => `memba_os_dao_draft:${chainId}:${wallet}`

function isDraft(v: unknown): v is DaoDraft {
    if (!v || typeof v !== "object") return false
    const d = v as Record<string, unknown>
    return typeof d.name === "string" && typeof d.description === "string" && typeof d.preset === "string"
        && Array.isArray(d.members) && d.members.every((m) => m && typeof m.address === "string" && typeof m.powerText === "string" && typeof m.role === "string")
        && typeof d.threshold === "number" && typeof d.quorum === "number"
        && Array.isArray(d.categories) && d.categories.every((c) => typeof c === "string") && typeof d.treasury === "boolean"
}

export function readDaoDraft(chainId: string, wallet: string): DaoDraft | null {
    try {
        const raw = localStorage.getItem(draftKey(chainId, wallet))
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (!isDraft(parsed)) return null
        // A stale role (e.g. from an older preset) falls back to the preset's first label.
        const roles = presetById(parsed.preset).roles
        return { ...parsed, members: parsed.members.map((m) => (roles.includes(m.role) ? m : { ...m, role: roles[0] })) }
    } catch {
        return null
    }
}

export function saveDaoDraft(chainId: string, wallet: string, d: DaoDraft): void {
    try { localStorage.setItem(draftKey(chainId, wallet), JSON.stringify(d)) } catch { /* storage refused: the draft lasts for this visit */ }
}

export function clearDaoDraft(chainId: string, wallet: string): void {
    try { localStorage.removeItem(draftKey(chainId, wallet)) } catch { /* nothing to clear */ }
}
