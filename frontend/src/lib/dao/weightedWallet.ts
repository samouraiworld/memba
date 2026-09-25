/**
 * The weighted DAO's one addition to the shared signing guard
 * (`walletNetworkGuard`, run by `doContractBroadcast` before and after the
 * caller's pre-sign checks): governance writes stay on hold on the hold-list
 * chains (gnoland-1). The shared guard already refuses a wallet on any chain
 * other than the page's, so this also refuses a page or a wallet on a held
 * chain outright, even if the two ever agreed.
 */
import { assertLiveWalletNetwork, networkLabelForChain, WalletNetworkError, type LiveWalletNetwork } from "../walletNetworkGuard"
import { WEIGHTED_WRITE_HOLD_CHAINS } from "./weighted"

export async function assertLiveWalletChain(expected: { chainId: string; address: string }): Promise<LiveWalletNetwork> {
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(expected.chainId)) throw new WalletNetworkError("Mainnet governance writes remain on hold")
    const live = await assertLiveWalletNetwork(expected.chainId, { address: expected.address })
    if (WEIGHTED_WRITE_HOLD_CHAINS.includes(live.chainId)) throw new WalletNetworkError(`Your wallet is on ${networkLabelForChain(live.chainId)}, where governance writes remain on hold`)
    return live
}
