/**
 * Live wallet-network check for weighted DAO v12 writes, run right before
 * signing. The shared broadcast guard (grc20 `assertWalletBroadcastSafe`)
 * compares a chain id cached at connect time and skips the check when that
 * id is empty; this asks the wallet again and fails closed.
 */
import { isTrustedRpcDomain } from "../config"
import { WEIGHTED_WRITE_HOLD_CHAINS } from "./weighted"

type AdenaLike = {
    GetAccount?: () => Promise<{ status?: string; data?: { address?: unknown; chainId?: unknown } } | undefined>
    GetNetwork?: () => Promise<{ data?: { chainId?: unknown; rpcUrl?: unknown } } | undefined>
}

const text = (v: unknown) => (typeof v === "string" ? v : "")

/**
 * Refuse unless the wallet, asked now, is on `chainId` (never a held chain),
 * through a trusted RPC, with the account `address`.
 */
export async function assertLiveWalletChain(expected: { chainId: string; address: string }): Promise<void> {
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(expected.chainId)) throw new Error("Mainnet governance writes remain on hold")
    const adena = (window as unknown as { adena?: AdenaLike }).adena
    if (!adena?.GetAccount || !adena.GetNetwork) throw new Error("Your wallet's network cannot be verified; reconnect before signing")
    const [account, network] = await Promise.all([adena.GetAccount(), adena.GetNetwork()])
    const accountChain = text(account?.data?.chainId), networkChain = text(network?.data?.chainId), rpcUrl = text(network?.data?.rpcUrl)
    const chain = networkChain || accountChain
    if (account?.status === "failure" || !chain) throw new Error("Your wallet's network is unknown; reconnect before signing")
    if (accountChain && networkChain && accountChain !== networkChain) throw new Error("Your wallet reports two different networks; reconnect before signing")
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(chain)) throw new Error(`Your wallet is on ${chain}, where governance writes remain on hold`)
    if (chain !== expected.chainId) throw new Error(`Your wallet is on ${chain}, not ${expected.chainId}; switch networks before signing`)
    if (!rpcUrl || !isTrustedRpcDomain(rpcUrl)) throw new Error("Your wallet's RPC cannot be trusted; switch it to a trusted RPC before signing")
    if (text(account?.data?.address) !== expected.address) throw new Error("Your wallet account changed; prepare the action again")
}
