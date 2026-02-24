/** Shared outlet context provided by Layout to all child routes. */
export interface LayoutContext {
    adena: {
        connected: boolean
        address: string
        chainId: string
        installed: boolean
        loading: boolean
        connect: () => void
        disconnect: () => void
    }
    balance: string
}
