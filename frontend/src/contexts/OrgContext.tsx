/**
 * OrgContext — Team/workspace context for Memba.
 *
 * Provides org state (active team, personal/team mode) to the app.
 * Uses Memba backend Team RPCs — no Clerk dependency.
 *
 * When no team is selected, all features operate in personal mode
 * with zero impact on existing functionality.
 *
 * @module contexts/OrgContext
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react"
import type { ReactNode } from "react"

export interface OrgState {
    /** Active team ID, or null for personal workspace. */
    activeOrgId: string | null
    /** Active team name, or "Personal" for personal workspace. */
    activeOrgName: string
    /** Whether we're in team mode (vs personal). */
    isOrgMode: boolean
    /** Switch to a different team (or null for personal). */
    setActiveOrg: (orgId: string | null, orgName?: string) => void
}

const defaultState: OrgState = {
    activeOrgId: null,
    activeOrgName: "Personal",
    isOrgMode: false,
    setActiveOrg: () => {},
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
        const state = { id: orgId, name: orgName || (orgId ? "Team" : "Personal") }
        setActiveOrgState(state)
        try {
            localStorage.setItem(LS_ACTIVE_ORG, JSON.stringify(state))
        } catch { /* quota */ }
    }, [])

    const value = useMemo<OrgState>(() => ({
        activeOrgId: activeOrg.id,
        activeOrgName: activeOrg.name,
        isOrgMode: activeOrg.id !== null,
        setActiveOrg,
    }), [activeOrg, setActiveOrg])

    return (
        <OrgContext.Provider value={value}>
            {children}
        </OrgContext.Provider>
    )
}
