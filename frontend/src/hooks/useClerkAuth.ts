/**
 * useClerkAuth — Hook for Clerk authentication in alerting features.
 *
 * Wraps @clerk/clerk-react hooks for the Memba alerting context:
 * - getToken() returns a fresh JWT per-request (never cached — F16)
 * - ensureUser() auto-provisions the user on first sign-in (409 = success — F5)
 * - Graceful degradation when Clerk is not loaded
 *
 * @module hooks/useClerkAuth
 */

import { useEffect, useRef, useCallback } from "react"
import { useAuth, useUser } from "@clerk/clerk-react"
import { GNO_MONITORING_API_URL } from "../lib/config"

export interface ClerkAuthState {
    /** Whether Clerk has finished loading */
    isLoaded: boolean
    /** Whether the user is signed in */
    isSignedIn: boolean
    /** Get a fresh JWT — call per-request, never cache */
    getToken: () => Promise<string | null>
    /** Clerk sign-out function */
    signOut: () => Promise<void>
    /** User profile (null if not signed in) */
    user: {
        id: string
        email: string | null
        fullName: string | null
        imageUrl: string
    } | null
    /** True if user has publicMetadata.role === "admin" */
    isAdmin: boolean
}

/**
 * Auto-provisioning: POST /users to create the user if not exists.
 * 409 Conflict = user already exists = success (F5).
 */
async function ensureUserOnBackend(token: string, name: string, email: string): Promise<void> {
    if (!GNO_MONITORING_API_URL) return

    try {
        const res = await fetch(`${GNO_MONITORING_API_URL}/users`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ name, email }),
            signal: AbortSignal.timeout(8000),
        })
        // 201 = created, 409 = already exists — both are success
        if (res.ok || res.status === 409) return
        console.warn("[useClerkAuth] ensureUser unexpected status:", res.status)
    } catch (err) {
        // Non-blocking — user can still use the UI, just won't have webhooks yet
        console.warn("[useClerkAuth] ensureUser failed:", err)
    }
}

export function useClerkAuth(): ClerkAuthState {
    const { isLoaded, isSignedIn, getToken, signOut } = useAuth()
    const { user } = useUser()
    const provisionedRef = useRef(false)

    // Auto-provision user on first sign-in (inside useEffect — proper side effect)
    useEffect(() => {
        if (!isLoaded || !isSignedIn || !user || provisionedRef.current) return
        provisionedRef.current = true
        const email = user.primaryEmailAddress?.emailAddress || ""
        const name = user.fullName || user.firstName || ""
        getToken().then(token => {
            if (token) ensureUserOnBackend(token, name, email)
        })
    }, [isLoaded, isSignedIn, user, getToken])

    // Reset provisioning flag on sign-out
    useEffect(() => {
        if (isLoaded && !isSignedIn) {
            provisionedRef.current = false
        }
    }, [isLoaded, isSignedIn])

    const wrappedGetToken = useCallback(async (): Promise<string | null> => {
        if (!isLoaded || !isSignedIn) return null
        return getToken()
    }, [isLoaded, isSignedIn, getToken])

    const wrappedSignOut = useCallback(async () => {
        provisionedRef.current = false
        await signOut()
    }, [signOut])

    return {
        isLoaded,
        isSignedIn: isLoaded && isSignedIn === true,
        getToken: wrappedGetToken,
        signOut: wrappedSignOut,
        user: isLoaded && isSignedIn && user ? {
            id: user.id,
            email: user.primaryEmailAddress?.emailAddress || null,
            fullName: user.fullName,
            imageUrl: user.imageUrl,
        } : null,
        isAdmin: isLoaded && isSignedIn && user?.publicMetadata?.role === "admin",
    }
}
