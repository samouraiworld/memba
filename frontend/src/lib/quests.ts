/**
 * quests.ts — Memba DAO quest system for Bootstrap Era onboarding.
 *
 * Sprint 13: 10 quests that users complete to earn XP and unlock
 * Memba DAO candidature. Dual-write: localStorage (offline-first) + backend.
 */

import { api } from "./api"
import { trackEvent } from "./analytics"
import { ALL_QUESTS } from "./gnobuilders"
import { create } from "@bufbuild/protobuf"
import {
    CompleteQuestRequestSchema,
    GetUserQuestsRequestSchema,
    SyncQuestsRequestSchema,
    QuestCompletionSchema,
} from "../gen/memba/v1/memba_pb"
import type { Token } from "../gen/memba/v1/memba_pb"

// ── Types ────────────────────────────────────────────────────

export interface Quest {
    id: string
    title: string
    description: string
    xp: number
    icon: string
}

export interface QuestProgress {
    questId: string
    completedAt: number // timestamp
}

export interface UserQuestState {
    completed: QuestProgress[]
    totalXP: number
}

// ── Quest Definitions ────────────────────────────────────────

export const QUESTS: Quest[] = [
    { id: "connect-wallet", title: "Connect Wallet", description: "Connect your Adena wallet to Memba", xp: 10, icon: "🔐" },
    { id: "visit-5-pages", title: "Explorer", description: "Visit 5 different pages", xp: 10, icon: "🧭" },
    { id: "browse-proposals", title: "Governance Viewer", description: "Browse a DAO's proposals", xp: 15, icon: "📋" },
    { id: "view-profile", title: "Identity Check", description: "View your profile page", xp: 10, icon: "👤" },
    { id: "use-cmdk", title: "Power User", description: "Use the Cmd+K command palette", xp: 10, icon: "⌨️" },
    { id: "switch-network", title: "Network Hopper", description: "Switch between two networks", xp: 15, icon: "🌐" },
    { id: "directory-tabs", title: "Directory Explorer", description: "Browse 3 different tabs in Directory", xp: 15, icon: "📂" },
    { id: "submit-feedback", title: "Voice Heard", description: "Submit feedback via the Feedback page", xp: 20, icon: "📣" },
    { id: "view-validator", title: "Validator Watcher", description: "View a validator's detail page", xp: 10, icon: "🔗" },
    { id: "share-link", title: "Ambassador", description: "Copy a Memba share link", xp: 10, icon: "🔗" },
]

/**
 * XP threshold required for Memba DAO candidature.
 * v4.0: Raised from 100 to 350 (Gold rank) with GnoBuilders expansion.
 * Existing users who reached 100 XP before v4.0 are grandfathered
 * via the LEGACY_CANDIDATURE_THRESHOLD check.
 */
export const CANDIDATURE_XP_THRESHOLD = 350

/** Legacy threshold for grandfathered users who reached 100 XP before v4.0. */
export const LEGACY_CANDIDATURE_THRESHOLD = 100

/** Total possible XP from all quests. */
export const TOTAL_POSSIBLE_XP = QUESTS.reduce((sum, q) => sum + q.xp, 0) // 125

// ── Storage ──────────────────────────────────────────────────

const STORAGE_KEY_BASE = "memba_quests"

/**
 * H-06 fix: Per-wallet quest isolation.
 * Module-level wallet address — set once via setQuestWalletAddress() when wallet connects.
 * All storage keys are scoped: "memba_quests_{g1addr}", "memba_quest_pages_{g1addr}", etc.
 * Non-connected users fall back to the global key (quests still track for anonymous).
 */
let _questWalletAddr: string | null = null

/**
 * Set the active wallet address for quest storage isolation.
 * Call this when the wallet connects. Pass null on disconnect.
 * Triggers one-time migration from global → per-wallet keys on first connect.
 */
export function setQuestWalletAddress(address: string | null): void {
    const prev = _questWalletAddr
    _questWalletAddr = address

    // One-time migration: if global key exists and per-wallet doesn't → copy
    if (address && address !== prev) {
        _migrateGlobalToWallet(address)
    }
}

/** Get the active wallet address (for testing/external use). */
export function getQuestWalletAddress(): string | null {
    return _questWalletAddr
}

/**
 * Generate a storage key scoped to the active wallet.
 * Returns "baseKey_g1addr" when connected, "baseKey" when not.
 */
function _scopedKey(baseKey: string): string {
    return _questWalletAddr ? `${baseKey}_${_questWalletAddr}` : baseKey
}

/**
 * One-time migration: copy global quest data to per-wallet key.
 * Only runs if global key has data AND per-wallet key is empty.
 * Never deletes the global key (shared machine safety).
 */
function _migrateGlobalToWallet(address: string): void {
    try {
        const walletKey = `${STORAGE_KEY_BASE}_${address}`
        // Skip if per-wallet data already exists
        if (localStorage.getItem(walletKey)) return

        // Migrate quest progress
        const globalData = localStorage.getItem(STORAGE_KEY_BASE)
        if (globalData) {
            localStorage.setItem(walletKey, globalData)
        }

        // Migrate page visits
        const globalPages = localStorage.getItem("memba_quest_pages")
        if (globalPages && !localStorage.getItem(`memba_quest_pages_${address}`)) {
            localStorage.setItem(`memba_quest_pages_${address}`, globalPages)
        }

        // Migrate directory tabs
        const globalTabs = localStorage.getItem("memba_quest_dir_tabs")
        if (globalTabs && !localStorage.getItem(`memba_quest_dir_tabs_${address}`)) {
            localStorage.setItem(`memba_quest_dir_tabs_${address}`, globalTabs)
        }
    } catch { /* migration is best-effort */ }
}

/** Load quest progress from localStorage (scoped to active wallet). */
export function loadQuestProgress(): UserQuestState {
    try {
        const raw = localStorage.getItem(_scopedKey(STORAGE_KEY_BASE))
        if (!raw) return { completed: [], totalXP: 0 }
        const state = JSON.parse(raw) as UserQuestState
        return {
            completed: Array.isArray(state.completed) ? state.completed : [],
            totalXP: typeof state.totalXP === "number" ? state.totalXP : 0,
        }
    } catch {
        return { completed: [], totalXP: 0 }
    }
}

/** Save quest progress to localStorage (scoped to active wallet). */
function saveQuestProgress(state: UserQuestState): void {
    try {
        localStorage.setItem(_scopedKey(STORAGE_KEY_BASE), JSON.stringify(state))
    } catch { /* quota */ }
}

/** Check if a specific quest is completed. */
export function isQuestCompleted(questId: string): boolean {
    const state = loadQuestProgress()
    return state.completed.some(q => q.questId === questId)
}

/**
 * Complete a quest. Returns updated state, or null if already completed.
 * Dual-write: always writes to localStorage, fire-and-forget to backend if token available.
 */
/**
 * Find a quest by ID in the unified registry (v1 QUESTS + v2 ALL_QUESTS).
 * Returns a Quest-compatible object or undefined.
 */
function _findQuest(questId: string): Quest | undefined {
    // Check v1 first (10 original quests)
    const v1 = QUESTS.find(q => q.id === questId)
    if (v1) return v1
    // Check v2 GnoBuilders (85 quests)
    const v2 = ALL_QUESTS.find(q => q.id === questId)
    if (v2) return { id: v2.id, title: v2.title, description: v2.description, xp: v2.xp, icon: v2.icon }
    return undefined
}

export interface QuestResult {
    state: UserQuestState
    /** True if this quest pushed XP over the candidature threshold for the first time. */
    unlockedCandidature: boolean
}

export function completeQuest(questId: string, authToken?: Token): QuestResult | null {
    // Search unified quest registry (v1 + v2 GnoBuilders)
    const quest = _findQuest(questId)
    if (!quest) return null

    const state = loadQuestProgress()
    if (state.completed.some(q => q.questId === questId)) return null // already done

    const wasBelowThreshold = state.totalXP < CANDIDATURE_XP_THRESHOLD
    state.completed.push({ questId, completedAt: Date.now() })
    state.totalXP += quest.xp
    saveQuestProgress(state)

    // Analytics
    trackEvent("Quest Completed", { questId, xp: quest.xp })

    // Fire-and-forget backend sync
    if (authToken) {
        api.completeQuest(create(CompleteQuestRequestSchema, {
            authToken,
            questId,
        })).catch(() => { /* offline-first: ignore backend errors */ })
    }

    return {
        state,
        unlockedCandidature: wasBelowThreshold && state.totalXP >= CANDIDATURE_XP_THRESHOLD,
    }
}

/**
 * Check if user has enough XP for candidature.
 * Grandfathering: users who reached 100 XP before GnoBuilders v4.0
 * are still eligible even if below the new 350 XP threshold.
 */
export function canApplyForMembership(): boolean {
    const state = loadQuestProgress()
    if (state.totalXP >= CANDIDATURE_XP_THRESHOLD) return true
    // Grandfathering: check if user was eligible under the old threshold
    // and has the legacy flag set (old quests completed before v4.0)
    if (state.totalXP >= LEGACY_CANDIDATURE_THRESHOLD && isLegacyEligible()) return true
    return false
}

/**
 * Check if user has legacy eligibility (reached 100 XP before v4.0).
 * Set automatically when v1 quests were completed before the threshold change.
 */
function isLegacyEligible(): boolean {
    try {
        return localStorage.getItem(_scopedKey("memba_legacy_candidature")) === "true"
    } catch {
        return false
    }
}

/**
 * Mark the current user as legacy-eligible if they meet the old threshold.
 * Call this once during migration (e.g., on first load after v4.0 upgrade).
 * Per-wallet scoped to prevent cross-wallet leakage.
 */
export function checkAndSetLegacyEligibility(): void {
    try {
        const state = loadQuestProgress()
        if (state.totalXP >= LEGACY_CANDIDATURE_THRESHOLD) {
            localStorage.setItem(_scopedKey("memba_legacy_candidature"), "true")
        }
    } catch { /* */ }
}

/** Get completion percentage (0-100). */
export function getCompletionPercent(): number {
    const state = loadQuestProgress()
    return Math.round((state.completed.length / QUESTS.length) * 100)
}

// ── Backend Sync ─────────────────────────────────────────────

/**
 * Sync localStorage quests to backend on first authenticated session.
 * Merges local completions with server state, server is authoritative for XP.
 */
export async function syncQuestsToBackend(authToken: Token): Promise<UserQuestState> {
    const local = loadQuestProgress()

    // Upload local completions to backend (server ignores duplicates + validates quest IDs)
    const completions = local.completed.map(c =>
        create(QuestCompletionSchema, {
            questId: c.questId,
            completedAt: new Date(c.completedAt).toISOString(),
        })
    )

    try {
        const resp = await api.syncQuests(create(SyncQuestsRequestSchema, {
            authToken,
            completions,
        }))

        if (resp.state) {
            // Server state is authoritative — merge back to localStorage
            const serverState: UserQuestState = {
                completed: resp.state.completed.map(c => ({
                    questId: c.questId,
                    completedAt: new Date(c.completedAt).getTime(),
                })),
                totalXP: resp.state.totalXp,
            }
            saveQuestProgress(serverState)
            return serverState
        }
    } catch {
        // Offline-first: if backend is unreachable, local state is still valid
    }

    return local
}

/**
 * Fetch quest state for any user (public read, no auth needed).
 */
export async function fetchUserQuests(address: string): Promise<UserQuestState | null> {
    try {
        const resp = await api.getUserQuests(create(GetUserQuestsRequestSchema, { address }))
        if (resp.state) {
            return {
                completed: resp.state.completed.map(c => ({
                    questId: c.questId,
                    completedAt: new Date(c.completedAt).getTime(),
                })),
                totalXP: resp.state.totalXp,
            }
        }
    } catch {
        // Backend unreachable
    }
    return null
}

// ── Page Visit Tracking ──────────────────────────────────────

const PAGES_KEY_BASE = "memba_quest_pages"

/** Track a page visit for the "visit 5 pages" quest (per-wallet scoped). */
export function trackPageVisit(pageName: string, authToken?: Token): void {
    try {
        const key = _scopedKey(PAGES_KEY_BASE)
        const raw = localStorage.getItem(key)
        const pages: string[] = raw ? JSON.parse(raw) : []
        if (!pages.includes(pageName)) {
            pages.push(pageName)
            localStorage.setItem(key, JSON.stringify(pages))
            if (pages.length >= 5) {
                completeQuest("visit-5-pages", authToken)
            }
        }
    } catch { /* */ }
}

const DIR_TABS_KEY_BASE = "memba_quest_dir_tabs"

/** Track directory tab visits for the "browse 3 tabs" quest (per-wallet scoped). */
export function trackDirectoryTab(tabName: string, authToken?: Token): void {
    try {
        const key = _scopedKey(DIR_TABS_KEY_BASE)
        const raw = localStorage.getItem(key)
        const tabs: string[] = raw ? JSON.parse(raw) : []
        if (!tabs.includes(tabName)) {
            tabs.push(tabName)
            localStorage.setItem(key, JSON.stringify(tabs))
            if (tabs.length >= 3) {
                completeQuest("directory-tabs", authToken)
            }
        }
    } catch { /* */ }
}

