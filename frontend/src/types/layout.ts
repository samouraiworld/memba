import type { Token } from "../gen/memba/v1/memba_pb"

/** Shared outlet context provided by Layout to all child routes. */
export interface LayoutContext {
    adena: {
        connected: boolean
        address: string
        pubkeyJSON: string
        chainId: string
        installed: boolean
        loading: boolean
        connect: () => Promise<boolean>
        disconnect: () => void
        signArbitrary: (data: string) => Promise<string | null>
    }
    balance: string
    auth: {
        token: Token | null
        isAuthenticated: boolean
        address: string
        loading: boolean
        error: string | null
    }
    /** True while wallet is reconnecting or auth is in progress */
    isLoggingIn: boolean
    /** True when wallet sync has exceeded the 10s timeout */
    syncTimedOut: boolean
}

