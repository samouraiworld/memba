/**
 * OrgSwitcher — Clerk Organization switcher for the sidebar.
 *
 * Shows a compact workspace indicator:
 * - "Personal" when in personal mode
 * - Org name when in org mode
 * - Dropdown to switch between personal and organizations
 *
 * Clerk OrganizationSwitcher is lazy-loaded on first interaction.
 * Until loaded, shows a simple indicator with the active workspace name.
 *
 * @module components/layout/OrgSwitcher
 */

import { useState, lazy, Suspense } from "react"
import { useOrg } from "../../contexts/OrgContext"

// Lazy-load the Clerk OrganizationSwitcher only when user clicks
const ClerkOrgUI = lazy(() => import("./ClerkOrgUI"))

interface Props {
    collapsed: boolean
}

export function OrgSwitcher({ collapsed }: Props) {
    const { orgsEnabled, activeOrgName, isOrgMode, clerkLoaded } = useOrg()
    const [showClerkUI, setShowClerkUI] = useState(false)

    if (!orgsEnabled) return null

    return (
        <div className="k-org-switcher">
            <button
                className="k-org-switcher-btn"
                onClick={() => setShowClerkUI(prev => !prev)}
                title={collapsed ? `Workspace: ${activeOrgName}` : undefined}
            >
                <span className={`k-org-indicator${isOrgMode ? " k-org-indicator--org" : ""}`}>
                    {isOrgMode ? activeOrgName.charAt(0).toUpperCase() : "P"}
                </span>
                {!collapsed && (
                    <span className="k-org-name">{activeOrgName}</span>
                )}
            </button>
            {showClerkUI && (
                <Suspense fallback={
                    <div className="k-org-dropdown-loading">Loading...</div>
                }>
                    <ClerkOrgUI
                        onClose={() => setShowClerkUI(false)}
                        clerkAlreadyLoaded={clerkLoaded}
                    />
                </Suspense>
            )}
        </div>
    )
}
