/**
 * Which stored Memba token belongs to the EVM session. One session per network
 * family: on an EVM network a gno.land token is not ours (left alone, never
 * used), and an EVM token counts only for the connected account on this chain.
 *
 * @module os/evm/sessionRules
 */

interface StoredToken {
    chainId: string
    userAddress: string
}

/** CAIP-2 id of an EVM network, as the backend binds tokens: "eip155:84532". */
export function caip2(chainId: string): string {
    return `eip155:${chainId}`
}

/** A token minted for an EVM chain (SIWE), whichever chain. */
export function isEvmToken(token: StoredToken | null | undefined): token is StoredToken {
    return !!token && token.chainId.startsWith("eip155:")
}

/**
 * The token signs in exactly this account (lowercase `0x…`) on exactly this chain.
 * The backend names a key holder `0x…` and a contract account (a Safe, a smart
 * wallet) `eip155:<id>:0x…`; both count.
 */
export function tokenFits(token: StoredToken | null | undefined, chainCaip2: string, address: string): boolean {
    if (!isEvmToken(token) || !address || token.chainId !== chainCaip2) return false
    const who = token.userAddress.toLowerCase()
    return who === address || who === `${chainCaip2}:${address}`
}
