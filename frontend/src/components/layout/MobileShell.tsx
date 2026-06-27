import type { ReactNode } from "react"

interface MobileShellProps {
    children: ReactNode
}

/**
 * Mobile layout shell: the main column WITHOUT the desktop Sidebar. The split
 * from {@link DesktopShell} (selected by `useIsMobile()` in `Layout`) means the
 * sidebar is genuinely absent from the mobile DOM rather than CSS-hidden, giving
 * mobile a clean seam to restructure on in later phases. The bottom `MobileTabBar`
 * and global overlays stay in `Layout`, shared across both shells.
 */
export function MobileShell({ children }: MobileShellProps) {
    return <div className="k-main-column">{children}</div>
}
