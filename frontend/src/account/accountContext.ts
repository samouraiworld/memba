/**
 * The optional Memba account (off-chain extras), shared by the OS shell and
 * the classic pages. Nothing loads until someone asks to sign in, or a
 * previous session is remembered on this device; a guest never fetches Clerk.
 *
 * @module account/accountContext
 */
import { createContext, useContext } from "react"

/** off: nothing loaded; loading; ready: Clerk answered; failed: Clerk did not load (the rest of Memba is unaffected). */
export type AccountStatus = "off" | "loading" | "ready" | "failed"

export interface AccountUser {
    id: string
    email: string | null
    fullName: string | null
    isAdmin: boolean
}

export interface AccountApi {
    /** False when this build has no Clerk key: nobody can sign in. */
    available: boolean
    status: AccountStatus
    user: AccountUser | null
    /** Loads Clerk and opens its sign-in. */
    openSignIn: () => void
    /** A fresh session token per call (never cached), or null when signed out. */
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
