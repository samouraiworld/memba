/**
 * Notification system for Memba.
 *
 * Stores notifications in localStorage, scoped per wallet address.
 * Designed for DAO governance events: proposals, votes, candidatures.
 *
 * Expert patterns:
 *  - Per-wallet isolation (separate keys per address)
 *  - FIFO eviction at MAX_NOTIFICATIONS cap
 *  - Sanitized display text (no raw HTML)
 *  - Grouped by type for UI rendering
 */

// ── Types ─────────────────────────────────────────────────────

export type NotificationType =
    | "proposal_new"
    | "proposal_passed"
    | "proposal_failed"
    | "candidature_submitted"
    | "candidature_approved"
    | "candidature_rejected"
    | "member_added"

export interface Notification {
    /** Unique ID: "{type}:{daoSlug}:{identifier}:{timestamp}" */
    id: string
    type: NotificationType
    title: string
    body: string
    /** DAO realm path (e.g. "gno.land/r/samcrew/memba_dao") */
    daoPath: string
    /** Internal navigation link (e.g. "/dao/samourai-dao/proposal/12") */
    link: string
    /** Unix timestamp in milliseconds */
    timestamp: number
    /** Whether the user has seen this notification */
    read: boolean
}

/** Notification grouped by date for UI rendering */
export interface NotificationGroup {
    label: string // "Today", "Yesterday", "This Week", "Older"
    items: Notification[]
}

// ── Constants ─────────────────────────────────────────────────

const STORAGE_PREFIX = "memba_notifications_"
const MAX_NOTIFICATIONS = 100
const DAY_MS = 86_400_000
let _idCounter = 0 // I6 fix: monotonic counter to prevent dedup race

// ── Sanitization ──────────────────────────────────────────────

/** Strip HTML tags and limit length for safe display. */
export function sanitizeText(text: string, maxLength = 200): string {
    const stripped = text.replace(/<[^>]*>/g, "").trim()
    return stripped.length > maxLength ? stripped.slice(0, maxLength) + "…" : stripped
}

// ── Storage ───────────────────────────────────────────────────

function storageKey(address: string): string {
    return STORAGE_PREFIX + address.toLowerCase()
}

/** Read all notifications for a wallet from localStorage. */
export function getNotifications(address: string): Notification[] {
    try {
        const raw = localStorage.getItem(storageKey(address))
        if (!raw) return []
        const parsed = JSON.parse(raw) as Notification[]
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

/** Write notifications to localStorage (internal). */
function saveNotifications(address: string, notifications: Notification[]): void {
    try {
        localStorage.setItem(storageKey(address), JSON.stringify(notifications))
    } catch {
        // localStorage full or disabled — silently fail
    }
}

/** Add a notification. Deduplicates by ID. Enforces FIFO cap. */
export function addNotification(
    address: string,
    n: Omit<Notification, "id" | "timestamp" | "read">,
): Notification {
    const notification: Notification = {
        ...n,
        title: sanitizeText(n.title, 100),
        body: sanitizeText(n.body, 200),
        id: `${n.type}:${n.daoPath}:${Date.now()}:${_idCounter++}`,
        timestamp: Date.now(),
        read: false,
    }

    const existing = getNotifications(address)

    // Deduplicate: skip if same type + daoPath within last 5 seconds
    const duplicate = existing.find(
        e => e.type === notification.type
            && e.daoPath === notification.daoPath
            && Math.abs(e.timestamp - notification.timestamp) < 5000,
    )
    if (duplicate) return duplicate

    const updated = [notification, ...existing].slice(0, MAX_NOTIFICATIONS)
    saveNotifications(address, updated)
    return notification
}

/** Mark a single notification as read. */
export function markRead(address: string, id: string): void {
    const notifications = getNotifications(address)
    const idx = notifications.findIndex(n => n.id === id)
    if (idx >= 0) {
        notifications[idx].read = true
        saveNotifications(address, notifications)
    }
}

/** Mark all notifications as read. */
export function markAllRead(address: string): void {
    const notifications = getNotifications(address)
    notifications.forEach(n => { n.read = true })
    saveNotifications(address, notifications)
}

/** Get count of unread notifications. */
export function getUnreadCount(address: string): number {
    return getNotifications(address).filter(n => !n.read).length
}

/** Get notifications filtered by DAO path. */
export function getNotificationsForDAO(address: string, daoPath: string): Notification[] {
    return getNotifications(address).filter(n => n.daoPath === daoPath)
}

/** Get unread count for a specific DAO. */
export function getUnreadCountForDAO(address: string, daoPath: string): number {
    return getNotificationsForDAO(address, daoPath).filter(n => !n.read).length
}

/** Clear all notifications for a wallet. */
export function clearNotifications(address: string): void {
    try {
        localStorage.removeItem(storageKey(address))
    } catch { /* ignore */ }
}

// ── Grouping ──────────────────────────────────────────────────

/** Group notifications by relative date for display. */
export function groupNotifications(notifications: Notification[]): NotificationGroup[] {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()
    const yesterdayMs = todayMs - DAY_MS
    const weekMs = todayMs - 7 * DAY_MS

    const groups: Record<string, Notification[]> = {
        Today: [],
        Yesterday: [],
        "This Week": [],
        Older: [],
    }

    for (const n of notifications) {
        if (n.timestamp >= todayMs) groups.Today.push(n)
        else if (n.timestamp >= yesterdayMs) groups.Yesterday.push(n)
        else if (n.timestamp >= weekMs) groups["This Week"].push(n)
        else groups.Older.push(n)
    }

    return Object.entries(groups)
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => ({ label, items }))
}

// ── Formatting ────────────────────────────────────────────────

/** Format timestamp as relative time (e.g. "2m ago", "1h ago", "3d ago"). */
export function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp
    if (diff < 60_000) return "just now"
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)}h ago`
    if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`
    return new Date(timestamp).toLocaleDateString()
}

/** Get icon for notification type. */
export function getNotificationIcon(type: NotificationType): string {
    switch (type) {
        case "proposal_new": return "📋"
        case "proposal_passed": return "✅"
        case "proposal_failed": return "❌"
        case "candidature_submitted": return "📝"
        case "candidature_approved": return "🎉"
        case "candidature_rejected": return "🚫"
        case "member_added": return "👋"
        default: return "🔔"
    }
}
