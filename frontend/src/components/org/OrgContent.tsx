/**
 * OrgContent — Clerk-powered team management UI (Memba-branded).
 *
 * Loaded via React.lazy() from OrganizationsPage. All Clerk components
 * are wrapped with Memba styling — no Clerk branding is exposed.
 *
 * Sections:
 * 1. Current workspace indicator with switch action
 * 2. Team list with member counts
 * 3. Create team form
 *
 * @module components/org/OrgContent
 */

import { useState, useEffect } from "react"
import {
    ClerkProvider as ClerkReactProvider,
    useAuth,
    useOrganization,
    useOrganizationList,
    SignIn,
    CreateOrganization,
} from "@clerk/clerk-react"
import { dark } from "@clerk/themes"
import { CLERK_PUBLISHABLE_KEY } from "../../lib/config"
import { useOrg } from "../../contexts/OrgContext"

/** Memba-styled appearance overrides for Clerk components. */
const clerkAppearance = {
    baseTheme: dark,
    variables: {
        colorPrimary: "#00d4aa",
        colorBackground: "#12121e",
        colorInputBackground: "rgba(255,255,255,0.04)",
        colorText: "#f0f0f0",
        colorTextSecondary: "#888",
        borderRadius: "8px",
        fontFamily: "'JetBrains Mono', monospace",
    },
    elements: {
        // Hide Clerk branding
        footer: { display: "none" },
        // Style cards to match Memba panels
        card: {
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px",
            boxShadow: "none",
        },
        headerTitle: {
            fontFamily: "'JetBrains Mono', monospace",
            color: "#f0f0f0",
        },
        headerSubtitle: {
            color: "#888",
        },
    },
}

function OrgInner() {
    const { isLoaded, isSignedIn } = useAuth()
    const { organization } = useOrganization()
    const { userMemberships, setActive } = useOrganizationList({
        userMemberships: { infinite: true },
    })
    const { setActiveOrg, markClerkLoaded, activeOrgId } = useOrg()
    const [showCreate, setShowCreate] = useState(false)

    useEffect(() => {
        if (isLoaded) markClerkLoaded()
    }, [isLoaded, markClerkLoaded])

    // Sync active org from Clerk to OrgContext
    useEffect(() => {
        if (organization) {
            setActiveOrg(organization.id, organization.name)
        }
    }, [organization, setActiveOrg])

    if (!isLoaded) {
        return <div className="org-loading">Loading...</div>
    }

    // Not signed in — show Memba-branded sign-in
    if (!isSignedIn) {
        return (
            <div className="org-auth-section">
                <div className="org-auth-card">
                    <h2 className="org-auth-title">Sign in to manage teams</h2>
                    <p className="org-auth-desc">
                        Create and join teams to share DAOs, alerts, and workspace configurations
                        with your collaborators. Sign in with your email to get started.
                    </p>
                    <div className="org-auth-clerk-wrapper">
                        <SignIn
                            appearance={clerkAppearance}
                            routing="hash"
                            forceRedirectUrl={window.location.href}
                        />
                    </div>
                </div>
            </div>
        )
    }

    const memberships = userMemberships?.data ?? []

    return (
        <div className="org-content">
            {/* Current Workspace */}
            <div className="org-section">
                <h2 className="org-section-title">Current Workspace</h2>
                <div className="org-workspace-cards">
                    {/* Personal */}
                    <button
                        className={`org-workspace-card${!activeOrgId ? " org-workspace-card--active" : ""}`}
                        onClick={() => {
                            if (setActive) setActive({ organization: null })
                            setActiveOrg(null)
                        }}
                    >
                        <div className="org-workspace-icon">
                            <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
                                <path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8C55.71,194.2,89.55,176,128,176s72.29,18.2,89.07,44a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" />
                            </svg>
                        </div>
                        <div className="org-workspace-info">
                            <span className="org-workspace-name">Personal</span>
                            <span className="org-workspace-desc">Your individual workspace</span>
                        </div>
                        {!activeOrgId && <span className="org-workspace-active-badge">Active</span>}
                    </button>

                    {/* Team workspaces */}
                    {memberships.map(mem => (
                        <button
                            key={mem.organization.id}
                            className={`org-workspace-card${activeOrgId === mem.organization.id ? " org-workspace-card--active" : ""}`}
                            onClick={() => {
                                if (setActive) setActive({ organization: mem.organization.id })
                                setActiveOrg(mem.organization.id, mem.organization.name)
                            }}
                        >
                            <div className="org-workspace-icon org-workspace-icon--team">
                                {mem.organization.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="org-workspace-info">
                                <span className="org-workspace-name">{mem.organization.name}</span>
                                <span className="org-workspace-desc">
                                    {mem.role === "org:admin" ? "Admin" : "Member"}
                                </span>
                            </div>
                            {activeOrgId === mem.organization.id && (
                                <span className="org-workspace-active-badge">Active</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Create Team */}
            <div className="org-section">
                <div className="org-section-header">
                    <h2 className="org-section-title">Create a Team</h2>
                </div>
                {showCreate ? (
                    <div className="org-create-wrapper">
                        <CreateOrganization
                            appearance={clerkAppearance}
                            routing="hash"
                            afterCreateOrganizationUrl={window.location.href}
                        />
                        <button
                            className="org-btn-secondary"
                            onClick={() => setShowCreate(false)}
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        className="org-btn-primary"
                        onClick={() => setShowCreate(true)}
                    >
                        + New Team
                    </button>
                )}
            </div>

            {/* Teams Overview */}
            {memberships.length > 0 && (
                <div className="org-section">
                    <h2 className="org-section-title">Your Teams ({memberships.length})</h2>
                    <div className="org-team-list">
                        {memberships.map(mem => (
                            <div key={mem.organization.id} className="org-team-row">
                                <div className="org-team-row-icon">
                                    {mem.organization.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="org-team-row-info">
                                    <span className="org-team-row-name">{mem.organization.name}</span>
                                    <span className="org-team-row-role">
                                        {mem.role === "org:admin" ? "Admin" : "Member"}
                                    </span>
                                </div>
                                {mem.role === "org:admin" && (
                                    <span className="org-team-row-badge">Admin</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default function OrgContent() {
    if (!CLERK_PUBLISHABLE_KEY) {
        return (
            <div className="org-empty-card">
                <p className="org-empty-title">Teams not configured</p>
                <p className="org-empty-desc">
                    Contact your administrator to enable team features.
                </p>
            </div>
        )
    }

    return (
        <ClerkReactProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            appearance={clerkAppearance}
        >
            <OrgInner />
        </ClerkReactProvider>
    )
}
