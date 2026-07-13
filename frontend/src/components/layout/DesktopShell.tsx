import type { ReactNode } from "react"
import { Sidebar } from "./Sidebar"

interface DesktopShellProps {
    connected: boolean
    address: string | null
    unvotedCount: number
    notifUnreadCount: number
    feedReplyUnread?: number
    collapsed: boolean
    onToggleCollapse: () => void
    children: ReactNode
}

/**
 * Desktop layout shell: the persistent Sidebar plus the main column. This is the
 * exact tree the app has always rendered on desktop — extracting it (paired with
 * {@link MobileShell}) lets `Layout` pick the shell by `useIsMobile()` so mobile
 * can drop the desktop chrome entirely instead of CSS-hiding it. Desktop output
 * is byte-identical: `Layout` composes the main-column content and passes it as
 * `children`, so nothing inside the column changes.
 */
export function DesktopShell({
    connected,
    address,
    unvotedCount,
    notifUnreadCount,
    feedReplyUnread = 0,
    collapsed,
    onToggleCollapse,
    children,
}: DesktopShellProps) {
    return (
        <>
            <Sidebar
                connected={connected}
                address={address}
                unvotedCount={unvotedCount}
                notifUnreadCount={notifUnreadCount}
                feedReplyUnread={feedReplyUnread}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
            />
            <div className="k-main-column">{children}</div>
        </>
    )
}
