/**
 * OrgContext — Clerk Organizations context for team/workspace features.
 *
 * Provides org state (active org, personal/org mode) to the app.
 * Clerk is lazy-loaded only when the user first interacts with org features
 * (e.g., clicking the org switcher in the sidebar).
 *
 * When Clerk is not loaded or not configured, all org functions return
 * personal-mode defaults — zero impact on existing features.
 *
 * @module contexts/OrgContext
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import { CLERK_PUBLISHABLE_KEY } from "../lib/config"

export interface OrgState {
    /** Whether Clerk Organizations is available (key configured). */
    orgsEnabled: boolean
    /** Active organization ID, or null for personal workspace. */
    activeOrgId: string | null
    /** Active organization name, or "Personal" for personal workspace. */
    activeOrgName: string
    /** Whether we're in org mode (vs personal). */
    isOrgMode: boolean
    /** Switch to a different org (or null for personal). */
    setActiveOrg: (orgId: string | null, orgName?: string) => void
    /** Whether the Clerk org UI has been loaded (lazy). */
    clerkLoaded: boolean
    /** Mark Clerk as loaded (called by the lazy org switcher). */
    markClerkLoaded: () => void
}

const defaultState: OrgState = {
    orgsEnabled: false,
    activeOrgId: null,
    activeOrgName: "Personal",
    isOrgMode: false,
    setActiveOrg: () => {},
    clerkLoaded: false,
    markClerkLoaded: () => {},
}

const OrgContext = createContext<OrgState>(defaultState)

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg(): OrgState {
    return useContext(OrgContext)
}

const LS_ACTIVE_ORG = "memba_active_org"

interface Props {
    children: ReactNode
}

export function OrgProvider({ children }: Props) {
    const orgsEnabled = !!CLERK_PUBLISHABLE_KEY
    const [clerkLoaded, setClerkLoaded] = useState(false)

    // Persist active org to localStorage
    const [activeOrg, setActiveOrgState] = useState<{ id: string | null; name: string }>(() => {
        try {
            const stored = localStorage.getItem(LS_ACTIVE_ORG)
            if (stored) {
                const parsed = JSON.parse(stored)
                if (typeof parsed.id === "string" && typeof parsed.name === "string") {
                    return parsed
                }
            }
        } catch { /* ignore */ }
        return { id: null, name: "Personal" }
    })

    const setActiveOrg = useCallback((orgId: string | null, orgName?: string) => {
        const state = { id: orgId, name: orgName || (orgId ? "Organization" : "Personal") }
        setActiveOrgState(state)
        try {
            localStorage.setItem(LS_ACTIVE_ORG, JSON.stringify(state))
        } catch { /* quota */ }
    }, [])

    const markClerkLoaded = useCallback(() => setClerkLoaded(true), [])

    const value = useMemo<OrgState>(() => ({
        orgsEnabled,
        activeOrgId: activeOrg.id,
        activeOrgName: activeOrg.name,
        isOrgMode: activeOrg.id !== null,
        setActiveOrg,
        clerkLoaded,
        markClerkLoaded,
    }), [orgsEnabled, activeOrg, setActiveOrg, clerkLoaded, markClerkLoaded])

    return (
        <OrgContext.Provider value={value}>
            {children}
        </OrgContext.Provider>
    )
}
