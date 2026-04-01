/**
 * quests.ts — Memba DAO quest system for Bootstrap Era onboarding.
 *
 * Sprint 13: 10 quests that users complete to earn XP and unlock
 * Memba DAO candidature. Progress tracked in localStorage only
 * (backend sync planned for v2.27 Sprint 4).
 */

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

/** XP threshold required for Memba DAO candidature. */
export const CANDIDATURE_XP_THRESHOLD = 100

/** Total possible XP from all quests. */
export const TOTAL_POSSIBLE_XP = QUESTS.reduce((sum, q) => sum + q.xp, 0) // 125

// ── Storage ──────────────────────────────────────────────────

const STORAGE_KEY = "memba_quests"

/** Load quest progress from localStorage. */
export function loadQuestProgress(): UserQuestState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
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

/** Save quest progress to localStorage. */
function saveQuestProgress(state: UserQuestState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch { /* quota */ }
}

/** Check if a specific quest is completed. */
export function isQuestCompleted(questId: string): boolean {
    const state = loadQuestProgress()
    return state.completed.some(q => q.questId === questId)
}

/**
 * Complete a quest. Returns updated state, or null if already completed.
 */
export function completeQuest(questId: string): UserQuestState | null {
    const quest = QUESTS.find(q => q.id === questId)
    if (!quest) return null

    const state = loadQuestProgress()
    if (state.completed.some(q => q.questId === questId)) return null // already done

    state.completed.push({ questId, completedAt: Date.now() })
    state.totalXP += quest.xp
    saveQuestProgress(state)
    return state
}

/** Check if user has enough XP for candidature. */
export function canApplyForMembership(): boolean {
    const state = loadQuestProgress()
    return state.totalXP >= CANDIDATURE_XP_THRESHOLD
}

/** Get completion percentage (0-100). */
export function getCompletionPercent(): number {
    const state = loadQuestProgress()
    return Math.round((state.completed.length / QUESTS.length) * 100)
}

// ── Page Visit Tracking ──────────────────────────────────────

const PAGES_KEY = "memba_quest_pages"

/** Track a page visit for the "visit 5 pages" quest. */
export function trackPageVisit(pageName: string): void {
    try {
        const raw = localStorage.getItem(PAGES_KEY)
        const pages: string[] = raw ? JSON.parse(raw) : []
        if (!pages.includes(pageName)) {
            pages.push(pageName)
            localStorage.setItem(PAGES_KEY, JSON.stringify(pages))
            if (pages.length >= 5) {
                completeQuest("visit-5-pages")
            }
        }
    } catch { /* */ }
}

const DIR_TABS_KEY = "memba_quest_dir_tabs"

/** Track directory tab visits for the "browse 3 tabs" quest. */
export function trackDirectoryTab(tabName: string): void {
    try {
        const raw = localStorage.getItem(DIR_TABS_KEY)
        const tabs: string[] = raw ? JSON.parse(raw) : []
        if (!tabs.includes(tabName)) {
            tabs.push(tabName)
            localStorage.setItem(DIR_TABS_KEY, JSON.stringify(tabs))
            if (tabs.length >= 3) {
                completeQuest("directory-tabs")
            }
        }
    } catch { /* */ }
}
