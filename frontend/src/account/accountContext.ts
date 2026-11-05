/**
 * The optional Memba account (off-chain extras), shared by the OS shell and
 * the classic pages. It is a Samourai account (Keycloak). Nothing loads until
 * someone asks to sign in, a previous session is remembered on this device, or
 * the page is the return of a sign-in redirect; a guest never loads the client.
 *
 * @module account/accountContext
 */
import { createContext, useContext } from "react"

/** off: nothing loaded; loading; ready: the sign-in client answered; failed: it did not load (the rest of Memba is unaffected). */
export type AccountStatus = "off" | "loading" | "ready" | "failed"

export interface AccountUser {
    id: string
    email: string | null
    fullName: string | null
    isAdmin: boolean
}

export interface AccountApi {
    /** False when this build has no Keycloak settings: nobody can sign in. */
    available: boolean
    status: AccountStatus
    user: AccountUser | null
    /** Loads the sign-in client and redirects to the sign-in page, unless a session already exists. */
    openSignIn: () => void
    /** A fresh access token per call (never cached), or null when signed out. */
    getToken: () => Promise<string | null>
    signOut: () => Promise<void>
}

export const SIGNED_OUT: AccountApi = {
    available: false,
    status: "off",
    user: null,
    openSignIn: () => {},
    getToken: async () => null,
    signOut: async () => {},
}

export const AccountContext = createContext<AccountApi>(SIGNED_OUT)

export function useAccount(): AccountApi {
    return useContext(AccountContext)
}

/** True when the URL fragment is the return of a sign-in redirect (the
 *  authorization response: state with a code or an error), which the
 *  sign-in client must finish on load. */
export function hasAuthCallback(hash: string): boolean {
    const params = new URLSearchParams(hash.replace(/^#/, ""))
    return params.has("state") && (params.has("code") || params.has("error"))
}
