import type { MemberInput, Step } from "../../components/dao/wizardShared"
import { DAO_PRESETS } from "../daoTemplate"
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
export type DraftContext = { chainId: string; wallet: string }
const unsavedDrafts = new Map<string, DraftData>()
export function clearDraftMemory() { unsavedDrafts.clear() }
export const LEGACY_DRAFT_KEY = "memba_dao_draft"
export const draftKey = ({ chainId, wallet }: DraftContext) => `memba_dao_draft:v2:${encodeURIComponent(chainId)}:${encodeURIComponent(wallet || "unbound")}`

export interface DraftData {
    name: string
    description: string
    realmPath: string
    members: MemberInput[]
    threshold: number
    quorum: number
    enableChannels?: boolean
    channelNames?: string[]
    /** Legacy draft fields (pre-W1.5 board naming) — read-only fallback. */
    enableBoard?: boolean
    boardChannels?: string[]
    availableRoles: string[]; proposalCategories: string[]
    selectedPreset: string | null; step: Step
    savedAt: number
}

export function isDraft(value: unknown): value is DraftData {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const d = value as Record<string, unknown>
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string")
    if (![d.name, d.description, d.realmPath].every(v => typeof v === "string")) return false
    if (!strings(d.availableRoles) || !strings(d.proposalCategories)) return false
    if (!Array.isArray(d.members) || !d.members.every(m => m && typeof m === "object" &&
        typeof m.address === "string" && Number.isSafeInteger(m.power) && strings(m.roles))) return false
    if (!Number.isSafeInteger(d.threshold) || !Number.isSafeInteger(d.quorum)) return false
    if (d.selectedPreset !== null && (typeof d.selectedPreset !== "string" || !DAO_PRESETS.some(p => p.id === d.selectedPreset))) return false
    if (typeof d.step !== "number" || !Number.isInteger(d.step) || d.step < 1 || d.step > 5) return false
    if (typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt) || d.savedAt > Date.now() || Date.now() - d.savedAt > DRAFT_TTL_MS) return false
    if ([d.enableChannels, d.enableBoard].some(v => v !== undefined && typeof v !== "boolean")) return false
    if ([d.channelNames, d.boardChannels].some(v => v !== undefined && !strings(v))) return false
    return true
}


export type DraftCandidate = { data: DraftData; key: string; needsAdoption: boolean }
function read(key: string, context?: DraftContext): DraftData | null {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const value = JSON.parse(raw)
        if (!context) return isDraft(value) ? value : null
        if (value?.version !== 2 || value.chainId !== context.chainId || value.wallet !== context.wallet) return null
        return isDraft(value.data) ? value.data : null
    } catch { return null }
}
export function loadDraft(context: DraftContext): DraftCandidate | null {
    const key = draftKey(context)
    const own = unsavedDrafts.get(key) ?? read(key, context)
    if (own) return { data: own, key, needsAdoption: false }
    if (context.wallet) {
        const unbound = { ...context, wallet: "" }
        const data = unsavedDrafts.get(draftKey(unbound)) ?? read(draftKey(unbound), unbound)
        if (data) return { data, key: draftKey(unbound), needsAdoption: true }
    }
    const legacy = read(LEGACY_DRAFT_KEY)
    return legacy ? { data: legacy, key: LEGACY_DRAFT_KEY, needsAdoption: true } : null
}
function writeDraft(context: DraftContext, data: Omit<DraftData, "savedAt">): void {
    const raw = JSON.stringify({ version: 2, ...context, data: { ...data, savedAt: Date.now() } })
    localStorage.setItem(draftKey(context), raw)
    if (localStorage.getItem(draftKey(context)) !== raw) throw new Error("Draft storage unavailable")
}
export function adoptDraft(context: DraftContext, candidate: DraftCandidate): DraftData {
    // Commit the destination before removing the source. Failed writes leave
    // legacy/unbound drafts recoverable and never silently bind them to a wallet.
    if (!candidate.needsAdoption) return candidate.data
    writeDraft(context, candidate.data)
    if (candidate.key !== draftKey(context)) localStorage.removeItem(candidate.key)
    unsavedDrafts.delete(candidate.key)
    return candidate.data
}
export function saveDraft(context: DraftContext, data: Omit<DraftData, "savedAt">): void {
    try { writeDraft(context, data); unsavedDrafts.delete(draftKey(context)) }
    catch (error) { unsavedDrafts.set(draftKey(context), { ...data, savedAt: Date.now() }); throw error }
}
export function discardDraftAtKey(key: string) {
    localStorage.removeItem(key)
    unsavedDrafts.delete(key)
}
export function clearDraft(context: DraftContext): void {
    unsavedDrafts.delete(draftKey(context))
    try { localStorage.removeItem(draftKey(context)) } catch { /* A successful transaction must remain a success. */ }
}
