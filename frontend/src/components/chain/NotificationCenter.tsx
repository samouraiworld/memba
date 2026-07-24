/**
 * NotificationCenter — Displays chain event notifications.
 *
 * Bell icon with unread badge, expandable panel with notification list.
 * Integrates with useNotifications() hook from events module.
 *
 * @module components/chain/NotificationCenter
 */

import React, { useState, useRef, useEffect, useCallback } from "react"
import type { NotificationItem } from "../../lib/chain/events"

export interface NotificationCenterProps {
    notifications: NotificationItem[]
    unreadCount: number
    onDismiss: (id: string) => void
    onMarkAllRead: () => void
    onClearAll: () => void
    className?: string
}

export function NotificationCenter({
    notifications,
    unreadCount,
    onDismiss,
    onMarkAllRead,
    onClearAll,
    className = "",
}: NotificationCenterProps) {
    const [isOpen, setIsOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [])

    // Auto-dismiss timed notifications
    useEffect(() => {
        const timers = notifications
            .filter(n => n.autoDismissMs > 0 && !n.read)
            .map(n => setTimeout(() => onDismiss(n.id), n.autoDismissMs))
        return () => timers.forEach(clearTimeout)
    }, [notifications, onDismiss])

    const toggle = useCallback(() => {
        setIsOpen(prev => !prev)
        if (!isOpen && unreadCount > 0) onMarkAllRead()
    }, [isOpen, unreadCount, onMarkAllRead])

    const typeIconMap: Record<NotificationItem["type"], string> = {
        info: "ℹ️",
        success: "✅",
        warning: "⚠️",
        error: "❌",
    }

    return React.createElement("div", {
        ref,
        className: `notification-center ${className}`,
        style: { position: "relative", display: "inline-block" },
    },
        // Bell trigger
        React.createElement("button", {
            className: "notification-center__trigger",
            onClick: toggle,
            "aria-label": `Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`,
        },
            "🔔",
            unreadCount > 0 && React.createElement("span", {
                className: "notification-center__badge",
            }, unreadCount > 9 ? "9+" : unreadCount),
        ),

        // Panel
        isOpen && React.createElement("div", {
            className: "notification-center__panel",
            role: "region",
            "aria-label": "Notifications",
        },
            React.createElement("div", { className: "notification-center__header" },
                React.createElement("span", null, `Notifications (${notifications.length})`),
                notifications.length > 0 && React.createElement("button", {
                    className: "notification-center__clear",
                    onClick: onClearAll,
                }, "Clear all"),
            ),

            notifications.length === 0
                ? React.createElement("p", { className: "notification-center__empty" }, "No notifications")
                : React.createElement("ul", { className: "notification-center__list" },
                    notifications.map(n =>
                        React.createElement("li", {
                            key: n.id,
                            className: `notification-center__item notification-center__item--${n.type}`,
                        },
                            React.createElement("span", { className: "notification-center__icon" }, typeIconMap[n.type]),
                            React.createElement("div", { className: "notification-center__content" },
                                React.createElement("strong", null, n.title),
                                React.createElement("p", null, n.message),
                                n.explorerUrl && React.createElement("a", {
                                    href: n.explorerUrl,
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                }, "View on explorer ↗"),
                            ),
                            React.createElement("button", {
                                className: "notification-center__dismiss",
                                onClick: () => onDismiss(n.id),
                                "aria-label": "Dismiss",
                            }, "×"),
                        ),
                    ),
                ),
        ),
    )
}
