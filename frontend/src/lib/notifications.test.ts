/**
 * Notification System Tests
 *
 * Covers: CRUD operations, localStorage isolation, sanitization,
 * FIFO eviction, deduplication, grouping, and formatting.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
    getNotifications,
    addNotification,
    markRead,
    markAllRead,
    getUnreadCount,
    clearNotifications,
    groupNotifications,
    formatRelativeTime,
    getNotificationIcon,
    sanitizeText,
    type Notification,
    type NotificationType,
} from "./notifications"

// ── Setup ─────────────────────────────────────────────────────

const TEST_ADDR = "g1test1234567890abcdefghijklmnopqrst"
const TEST_ADDR_2 = "g1other234567890abcdefghijklmnopqrst"

const makeNotification = (overrides: Partial<Omit<Notification, "id" | "timestamp" | "read">> = {}) => ({
    type: "proposal_new" as NotificationType,
    title: "New Proposal",
    body: "Proposal #1 in DAO",
    daoPath: "gno.land/r/test/dao",
    link: "/dao/test/proposal/1",
    ...overrides,
})

beforeEach(() => {
    localStorage.clear()
})

// ── CRUD ──────────────────────────────────────────────────────

describe("getNotifications", () => {
    it("returns empty array for fresh address", () => {
        expect(getNotifications(TEST_ADDR)).toEqual([])
    })

    it("returns stored notifications", () => {
        addNotification(TEST_ADDR, makeNotification())
        const result = getNotifications(TEST_ADDR)
        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("New Proposal")
    })

    it("returns empty on corrupt localStorage", () => {
        localStorage.setItem("memba_notifications_" + TEST_ADDR.toLowerCase(), "invalid-json")
        expect(getNotifications(TEST_ADDR)).toEqual([])
    })
})

describe("addNotification", () => {
    it("adds notification with generated ID and timestamp", () => {
        const n = addNotification(TEST_ADDR, makeNotification())
        expect(n.id).toContain("proposal_new:")
        expect(n.timestamp).toBeGreaterThan(0)
        expect(n.read).toBe(false)
    })

    it("prepends new notifications (newest first)", () => {
        addNotification(TEST_ADDR, makeNotification({ title: "First", type: "proposal_new", daoPath: "dao-a" }))
        addNotification(TEST_ADDR, makeNotification({ title: "Second", type: "proposal_passed", daoPath: "dao-b" }))
        const all = getNotifications(TEST_ADDR)
        expect(all[0].title).toBe("Second")
        expect(all[1].title).toBe("First")
    })

    it("deduplicates same type + daoPath within 5 seconds", () => {
        addNotification(TEST_ADDR, makeNotification())
        addNotification(TEST_ADDR, makeNotification())
        expect(getNotifications(TEST_ADDR)).toHaveLength(1)
    })

    it("allows same type from different DAOs", () => {
        addNotification(TEST_ADDR, makeNotification({ daoPath: "gno.land/r/dao1" }))
        addNotification(TEST_ADDR, makeNotification({ daoPath: "gno.land/r/dao2" }))
        expect(getNotifications(TEST_ADDR)).toHaveLength(2)
    })

    it("enforces FIFO cap at 100", () => {
        for (let i = 0; i < 105; i++) {
            addNotification(TEST_ADDR, makeNotification({
                type: "member_added",
                daoPath: `gno.land/r/dao${i}`,
            }))
        }
        expect(getNotifications(TEST_ADDR)).toHaveLength(100)
    })
})

// ── Read State ────────────────────────────────────────────────

describe("markRead", () => {
    it("marks specific notification as read", () => {
        const n = addNotification(TEST_ADDR, makeNotification())
        markRead(TEST_ADDR, n.id)
        const all = getNotifications(TEST_ADDR)
        expect(all[0].read).toBe(true)
    })

    it("no-ops for nonexistent ID", () => {
        addNotification(TEST_ADDR, makeNotification())
        markRead(TEST_ADDR, "nonexistent")
        expect(getNotifications(TEST_ADDR)[0].read).toBe(false)
    })
})

describe("markAllRead", () => {
    it("marks all notifications as read", () => {
        addNotification(TEST_ADDR, makeNotification({ type: "proposal_new", daoPath: "dao1" }))
        addNotification(TEST_ADDR, makeNotification({ type: "proposal_passed", daoPath: "dao2" }))
        markAllRead(TEST_ADDR)
        const all = getNotifications(TEST_ADDR)
        expect(all.every(n => n.read)).toBe(true)
    })
})

describe("getUnreadCount", () => {
    it("returns 0 for no notifications", () => {
        expect(getUnreadCount(TEST_ADDR)).toBe(0)
    })

    it("counts only unread", () => {
        const n1 = addNotification(TEST_ADDR, makeNotification({ daoPath: "dao1" }))
        addNotification(TEST_ADDR, makeNotification({ type: "proposal_passed", daoPath: "dao2" }))
        markRead(TEST_ADDR, n1.id)
        expect(getUnreadCount(TEST_ADDR)).toBe(1)
    })
})

// ── Isolation ─────────────────────────────────────────────────

describe("per-wallet isolation", () => {
    it("notifications are scoped to address", () => {
        addNotification(TEST_ADDR, makeNotification({ title: "For Addr 1" }))
        addNotification(TEST_ADDR_2, makeNotification({ title: "For Addr 2" }))
        expect(getNotifications(TEST_ADDR)).toHaveLength(1)
        expect(getNotifications(TEST_ADDR_2)).toHaveLength(1)
        expect(getNotifications(TEST_ADDR)[0].title).toBe("For Addr 1")
    })
})

describe("clearNotifications", () => {
    it("removes all notifications for address", () => {
        addNotification(TEST_ADDR, makeNotification())
        clearNotifications(TEST_ADDR)
        expect(getNotifications(TEST_ADDR)).toEqual([])
    })

    it("does not affect other addresses", () => {
        addNotification(TEST_ADDR, makeNotification())
        addNotification(TEST_ADDR_2, makeNotification())
        clearNotifications(TEST_ADDR)
        expect(getNotifications(TEST_ADDR_2)).toHaveLength(1)
    })
})

// ── Sanitization ──────────────────────────────────────────────

describe("sanitizeText", () => {
    it("strips HTML tags", () => {
        expect(sanitizeText("<script>alert('xss')</script>Hello")).toBe("alert('xss')Hello")
    })

    it("truncates long text", () => {
        const long = "a".repeat(300)
        const result = sanitizeText(long)
        expect(result.length).toBe(201) // 200 + "…"
        expect(result.endsWith("…")).toBe(true)
    })

    it("trims whitespace", () => {
        expect(sanitizeText("  hello  ")).toBe("hello")
    })
})

// ── Grouping ──────────────────────────────────────────────────

describe("groupNotifications", () => {
    it("groups into Today / Yesterday / This Week / Older", () => {
        const now = Date.now()
        const items: Notification[] = [
            { id: "1", type: "proposal_new", title: "t", body: "b", daoPath: "d", link: "/", timestamp: now, read: false },
            { id: "2", type: "proposal_new", title: "t", body: "b", daoPath: "d", link: "/", timestamp: now - 86_400_000 - 1, read: false },
            { id: "3", type: "proposal_new", title: "t", body: "b", daoPath: "d", link: "/", timestamp: now - 10 * 86_400_000, read: false },
        ]
        const groups = groupNotifications(items)
        expect(groups.length).toBeGreaterThanOrEqual(2)
        expect(groups[0].label).toBe("Today")
    })

    it("returns empty array for no notifications", () => {
        expect(groupNotifications([])).toEqual([])
    })
})

// ── Formatting ────────────────────────────────────────────────

describe("formatRelativeTime", () => {
    it("formats seconds as 'just now'", () => {
        expect(formatRelativeTime(Date.now() - 30_000)).toBe("just now")
    })

    it("formats minutes", () => {
        expect(formatRelativeTime(Date.now() - 120_000)).toBe("2m ago")
    })

    it("formats hours", () => {
        expect(formatRelativeTime(Date.now() - 7_200_000)).toBe("2h ago")
    })

    it("formats days", () => {
        expect(formatRelativeTime(Date.now() - 172_800_000)).toBe("2d ago")
    })

    it("formats old dates as locale string", () => {
        const old = Date.now() - 60 * 86_400_000
        const result = formatRelativeTime(old)
        expect(result).not.toContain("ago")
    })
})

describe("getNotificationIcon", () => {
    it("returns emoji for each type", () => {
        expect(getNotificationIcon("proposal_new")).toBe("📋")
        expect(getNotificationIcon("proposal_passed")).toBe("✅")
        expect(getNotificationIcon("proposal_failed")).toBe("❌")
        expect(getNotificationIcon("candidature_submitted")).toBe("📝")
        expect(getNotificationIcon("candidature_approved")).toBe("🎉")
        expect(getNotificationIcon("candidature_rejected")).toBe("🚫")
        expect(getNotificationIcon("member_added")).toBe("👋")
    })
})
