/**
 * The weighted DAO's one addition to the shared signing guard
 * (`walletNetworkGuard`, run by `doContractBroadcast` before and after the
 * caller's pre-sign checks): governance writes stay on hold on the hold-list
 * chains (gnoland-1), except for the DAOs in `WEIGHTED_WRITE_RELEASES`. The
 * shared guard already refuses a wallet on any chain other than the page's,
 * so this also refuses a page or a wallet on a held chain outright, even if
 * the two ever agreed.
 */
import { assertLiveWalletNetwork, networkLabelForChain, WalletNetworkError, type LiveWalletNetwork } from "../walletNetworkGuard"
import { weightedWritesHeld } from "./weighted"

export async function assertLiveWalletChain(expected: { chainId: string; address: string; schema: string; realmPath: string }): Promise<LiveWalletNetwork> {
    if (weightedWritesHeld(expected.chainId, expected.schema, expected.realmPath)) throw new WalletNetworkError("Mainnet governance writes remain on hold")
    const live = await assertLiveWalletNetwork(expected.chainId, { address: expected.address })
    if (weightedWritesHeld(live.chainId, expected.schema, expected.realmPath)) throw new WalletNetworkError(`Your wallet is on ${networkLabelForChain(live.chainId)}, where governance writes remain on hold`)
    // A release is per chain: never let a wallet on another chain through, even if the shared guard did.
    if (live.chainId !== expected.chainId) throw new WalletNetworkError(`Your wallet is on ${networkLabelForChain(live.chainId)}, not ${networkLabelForChain(expected.chainId)}`)
    return live
}
