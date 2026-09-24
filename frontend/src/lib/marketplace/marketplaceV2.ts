/**
 * marketplaceV2.ts — where the marketplace v2 lanes may run.
 *
 * The v2 Services lane (and the dev preview page) render the Founding-Supply
 * seed catalogue: design fixtures with placeholder sellers, not real
 * listings. VITE_ENABLE_MARKETPLACE_V2 alone must therefore never put them in
 * front of mainnet users: v2 counts as on only when the flag is set AND the
 * network the app is serving is a test network. Any network not explicitly
 * marked `isTestnet` (gnoland-1 today, any future production chain) keeps the
 * v1 lanes, whatever the flag says.
 */
import { ACTIVE_NETWORK_KEY, isMarketplaceV2Enabled, isTestnetNetwork } from "../config"

/** Whether the v2 lanes (and with them the seed catalogue) may render on `networkKey` (default: the network the app serves). */
export function isMarketplaceV2Active(networkKey: string = ACTIVE_NETWORK_KEY): boolean {
    return isMarketplaceV2Enabled() && isTestnetNetwork(networkKey)
}
