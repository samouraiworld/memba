/**
 * ClerkOrgUI — Lazy-loaded Clerk organization management UI.
 *
 * This component is loaded via React.lazy() when the user clicks the
 * org switcher. It wraps the Clerk OrganizationSwitcher with the
 * ClerkProvider and wires org selection to the OrgContext.
 *
 * Bundle impact: ~45KB loaded on demand (same as AlertsPage pattern).
 *
 * @module components/layout/ClerkOrgUI
 */

import { useEffect, useRef } from "react"
import { ClerkProvider as ClerkReactProvider, useOrganization, useOrganizationList, useAuth } from "@clerk/clerk-react"
import { dark } from "@clerk/themes"
import { CLERK_PUBLISHABLE_KEY } from "../../lib/config"
import { useOrg } from "../../contexts/OrgContext"

interface Props {
    onClose: () => void
}

function OrgDropdownContent({ onClose }: { onClose: () => void }) {
    const { setActiveOrg, markClerkLoaded } = useOrg()
    const { isLoaded, isSignedIn } = useAuth()
    const { organization } = useOrganization()
    const { userMemberships, setActive } = useOrganizationList({
        userMemberships: { infinite: true },
    })
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Mark Clerk as loaded once ready
    useEffect(() => {
        if (isLoaded) markClerkLoaded()
    }, [isLoaded, markClerkLoaded])

    // Sync active org from Clerk to OrgContext
    useEffect(() => {
        if (organization) {
            setActiveOrg(organization.id, organization.name)
        }
    }, [organization, setActiveOrg])

    // Close on click outside
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                onClose()
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [onClose])

    if (!isLoaded) {
        return <div className="k-org-dropdown-loading">Loading Clerk...</div>
    }

    if (!isSignedIn) {
        return (
            <div ref={dropdownRef} className="k-org-dropdown">
                <p className="k-org-dropdown-hint">
                    Sign in to Clerk to use Organizations.
                    You can sign in from the Alerts page.
                </p>
                <button className="k-org-dropdown-close" onClick={onClose}>Close</button>
            </div>
        )
    }

    const memberships = userMemberships?.data ?? []

    return (
        <div ref={dropdownRef} className="k-org-dropdown">
            <div className="k-org-dropdown-header">Workspace</div>
            {/* Personal workspace */}
            <button
                className="k-org-dropdown-item"
                onClick={() => {
                    if (setActive) setActive({ organization: null })
                    setActiveOrg(null)
                    onClose()
                }}
            >
                <span className="k-org-indicator">P</span>
                <span>Personal</span>
            </button>
            {/* Organizations */}
            {memberships.map(mem => (
                <button
                    key={mem.organization.id}
                    className="k-org-dropdown-item"
                    onClick={() => {
                        if (setActive) setActive({ organization: mem.organization.id })
                        setActiveOrg(mem.organization.id, mem.organization.name)
                        onClose()
                    }}
                >
                    <span className="k-org-indicator k-org-indicator--org">
                        {mem.organization.name.charAt(0).toUpperCase()}
                    </span>
                    <span>{mem.organization.name}</span>
                    <span className="k-org-role">{mem.role}</span>
                </button>
            ))}
            {memberships.length === 0 && (
                <p className="k-org-dropdown-hint">
                    No organizations yet. Create one from your Clerk dashboard.
                </p>
            )}
            <button className="k-org-dropdown-close" onClick={onClose}>Close</button>
        </div>
    )
}

export default function ClerkOrgUI({ onClose }: Props) {
    if (!CLERK_PUBLISHABLE_KEY) {
        return (
            <div className="k-org-dropdown">
                <p className="k-org-dropdown-hint">Organizations not configured.</p>
                <button className="k-org-dropdown-close" onClick={onClose}>Close</button>
            </div>
        )
    }

    return (
        <ClerkReactProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            appearance={{ baseTheme: dark }}
        >
            <OrgDropdownContent onClose={onClose} />
        </ClerkReactProvider>
    )
}
