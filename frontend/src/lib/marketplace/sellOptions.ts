/**
 * sellOptions.ts — the "Sell anything" routing map (marketplace-v2 Phase 4.2).
 *
 * One entry per LIVE lane (respecting per-lane flags — no "coming soon" rows), each
 * routing to that lane's create/list flow. Pure so it's trivially testable; the shell
 * passes the network key + resolved flags.
 *
 * @module lib/marketplace/sellOptions
 */
import type { AssetType } from "./types"

export interface SellOption {
    key: AssetType
    label: string
    /** Network-prefixed absolute path to the lane's create/list flow. */
    to: string
}

export interface LaneEnabled {
    nft: boolean
    service: boolean
    token: boolean
}

export function buildSellOptions(network: string, enabled: LaneEnabled): SellOption[] {
    const opts: SellOption[] = []
    if (enabled.nft) opts.push({ key: "nft", label: "List an NFT", to: `/${network}/nft/create` })
    if (enabled.service) opts.push({ key: "service", label: "Offer a service", to: `/${network}/marketplace/services` })
    if (enabled.token) opts.push({ key: "token", label: "List tokens (OTC)", to: `/${network}/marketplace/tokens` })
    return opts
}
