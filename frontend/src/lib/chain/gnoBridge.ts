/**
 * Bridge between the CAL's on-wire chainIds and config.ts's network KEYS.
 *
 * The app has two id-spaces: config.ts keys its NETWORKS map by identifier-safe keys
 * ("topaz", "test13", "gnoland1") while the CAL and the chain itself use on-wire chainIds
 * ("topaz-1", "test-13", "gnoland1"). config.ts is the single source of truth for which Gno
 * networks exist; this bridge maps between the two spaces so the CAL's switchChain can persist
 * to the existing `memba_network` key and ride the reload-on-switch contract (B-3).
 *
 * @module lib/chain/gnoBridge
 */

import { NETWORKS } from "../config"
import type { ChainId } from "./types"

/** The config network KEY (e.g. "topaz") for a Gno on-wire chainId (e.g. "topaz-1"), or
 *  undefined for EVM / unknown chains — those have no config.ts entry. */
export function chainIdToConfigKey(chainId: ChainId | string): string | undefined {
    return Object.keys(NETWORKS).find(k => NETWORKS[k].chainId === chainId)
}

/** The on-wire chainId for a config network key, or undefined if the key is unknown. */
export function configKeyToChainId(key: string): ChainId | undefined {
    return NETWORKS[key]?.chainId as ChainId | undefined
}
