/**
 * OrganizationsPage — Team management for Memba.
 *
 * Provides workspace switching (personal/team), team creation,
 * member management, and team settings. Uses Memba backend Team RPCs.
 *
 * Lazy-loaded: OrgContent only loaded when visiting this page.
 *
 * @module pages/OrganizationsPage
 */

import { lazy, Suspense, useEffect } from "react"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { ComingSoonGate } from "../components/ui/ComingSoonGate"
import { useOutletContext } from "react-router-dom"
import { trackPageVisit } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./organizations.css"

const OrgContent = lazy(() => import("../components/org/OrgContent"))

function PageLoader() {
    return <ConnectingLoader message="Loading teams..." minHeight="30vh" />
}

const TEAMS_ENABLED = import.meta.env.VITE_ENABLE_TEAMS === "true"

export default function OrganizationsPage() {
    const { adena } = useOutletContext<LayoutContext>()

    useEffect(() => { trackPageVisit("organizations") }, [])

    if (!TEAMS_ENABLED) {
        return (
            <ComingSoonGate
                title="Teams"
                icon="👥"
                description="Manage your teams and share DAOs, alerts, and configurations with collaborators."
                features={[
                    "Team workspaces for collaborative DAO management",
                    "Shared alerts and configurations",
                    "Role-based access control",
                    "Cross-team analytics dashboards",
                ]}
            />
        )
    }

    if (!adena.connected) {
        return (
            <div className="org-page">
                <div className="org-header">
                    <h1 className="org-title">Teams</h1>
                </div>
                <div className="org-empty-card">
                    <div className="org-empty-icon">
                        <svg width="48" height="48" viewBox="0 0 256 256" fill="currentColor" opacity="0.3">
                            <path d="M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM64,112a24,24,0,1,0-23.24-30A8,8,0,1,1,25.26,78,40,40,0,1,1,91,117.51a67.94,67.94,0,0,1,27.43,21.68,8,8,0,0,1-1.6,11.2,8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,64,128a8,8,0,0,1,0-16Z" />
                        </svg>
                    </div>
                    <h2 className="org-empty-title">Connect your wallet to manage teams</h2>
                    <p className="org-empty-desc">
                        Teams let you share DAOs, alerts, and configurations with your collaborators.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="org-page">
            <div className="org-header">
                <h1 className="org-title">Teams</h1>
                <p className="org-subtitle">
                    Manage your teams and switch between personal and team workspaces.
                </p>
            </div>
            <Suspense fallback={<PageLoader />}>
                <OrgContent />
            </Suspense>
        </div>
    )
}
