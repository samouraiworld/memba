/**
 * NotificationBell — Header bell icon with dropdown notification panel.
 *
 * Features:
 * - Red badge with unread count (hidden when 0)
 * - Dropdown with grouped notifications (Today / Yesterday / This Week / Older)
 * - Click notification → navigate + mark read
 * - "Mark all read" button
 * - Close on outside click
 * - Smooth open/close animations
 */

import { useState, useRef, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Bell } from "@phosphor-icons/react"
import {
    groupNotifications,
    formatRelativeTime,
    getNotificationIcon,
    type Notification,
} from "../../lib/notifications"
import "./notification-bell.css"

interface NotificationBellProps {
    notifications: Notification[]
    unreadCount: number
    onMarkRead: (id: string) => void
    onMarkAllRead: () => void
}

export function NotificationBell({ notifications, unreadCount, onMarkRead, onMarkAllRead }: NotificationBellProps) {
    const [open, setOpen] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const bellRef = useRef<HTMLButtonElement>(null)
    const navigate = useNavigate()

    // Close on outside click
    useEffect(() => {
        if (!open) return
        const handleClick = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        // Delay to avoid closing immediately on the opening click
        const timer = setTimeout(() => document.addEventListener("click", handleClick), 50)
        return () => {
            clearTimeout(timer)
            document.removeEventListener("click", handleClick)
        }
    }, [open])

    // Close on Escape + return focus to bell (I8 fix)
    useEffect(() => {
        if (!open) return
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false)
                bellRef.current?.focus()
            }
        }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [open])

    const handleNotificationClick = (n: Notification) => {
        onMarkRead(n.id)
        setOpen(false)
        bellRef.current?.focus()
        if (n.link) navigate(n.link)
    }

    // M10 fix: only compute groups when panel is open
    const groups = useMemo(
        () => open ? groupNotifications(notifications) : [],
        [open, notifications],
    )

    return (
        <div className="notif-bell-container" ref={panelRef}>
            <button
                className="notif-bell-btn"
                ref={bellRef}
                onClick={() => setOpen(!open)}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                aria-expanded={open}
                aria-haspopup="true"
                data-testid="notification-bell"
            >
                <Bell size={20} weight={unreadCount > 0 ? "fill" : "regular"} />
                {unreadCount > 0 && (
                    <span className="notif-badge" aria-live="polite" data-testid="notification-badge">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="notif-panel" role="menu" data-testid="notification-panel">
                    <div className="notif-panel-header">
                        <span className="notif-panel-title">Notifications</span>
                        {unreadCount > 0 && (
                            <button
                                className="notif-mark-all"
                                onClick={onMarkAllRead}
                                data-testid="notification-mark-all"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="notif-panel-body">
                        {notifications.length === 0 ? (
                            <div className="notif-empty">
                                <Bell size={32} weight="thin" />
                                <span>No notifications yet</span>
                            </div>
                        ) : (
                            groups.map(group => (
                                <div key={group.label} className="notif-group">
                                    <div className="notif-group-label">{group.label}</div>
                                    {group.items.map(n => (
                                        <button
                                            key={n.id}
                                            className={`notif-item ${n.read ? "" : "notif-unread"}`}
                                            onClick={() => handleNotificationClick(n)}
                                            data-testid={`notification-item-${n.id}`}
                                        >
                                            <span className="notif-icon">{getNotificationIcon(n.type)}</span>
                                            <div className="notif-content">
                                                <span className="notif-item-title">{n.title}</span>
                                                <span className="notif-item-body">{n.body}</span>
                                            </div>
                                            <span className="notif-time">{formatRelativeTime(n.timestamp)}</span>
                                            {!n.read && <span className="notif-dot" />}
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
