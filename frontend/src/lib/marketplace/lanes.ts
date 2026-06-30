/**
 * lanes.ts — the marketplace lane registry.
 *
 * A lane is one asset type's presence in the unified shell. Its `isLive` predicate
 * is the single source of truth for whether the lane's TAB renders — panel finding
 * C2: never show a "coming soon" tab in a trading UI (it reads as vaporware to the
 * crypto-native audience). A lane appears only when its feature flag AND its backing
 * realm validity are both true, mirroring each page's existing dual-gate.
 *
 * v1 ships nft + service. token + agent are roadmap (v1.1 / v1.2) and are added here
 * when those lanes are built — not stubbed as dead tabs.
 *
 * @module lib/marketplace/lanes
 */

import { isNftEnabled, isNftMarketV3Valid, isServicesEnabled, isEscrowValid, isTokensEnabled, isTokenOtcValid } from "../config"
import type { AssetType } from "./types"

export interface LaneDef {
    assetType: AssetType
    /** Tab label (sentence case). */
    label: string
    /** Tabler-style icon name for the tab. */
    icon: string
    /**
     * Whether the lane is live on the active network. Drives tab visibility. NFT keys
     * off isNftMarketV3Valid (the v3 engine it actually trades — W0.1), so the tab
     * stays hidden until v3.1 is registered, never rendering a dead lane.
     */
    isLive: () => boolean
}

/** All registered lanes, in display order. Only the live ones render (getLiveLanes). */
export const LANES: readonly LaneDef[] = [
    {
        assetType: "nft",
        label: "NFTs",
        icon: "photo",
        isLive: () => isNftEnabled() && isNftMarketV3Valid(),
    },
    {
        assetType: "service",
        label: "Services",
        icon: "briefcase",
        isLive: () => isServicesEnabled() && isEscrowValid(),
    },
    {
        assetType: "token",
        label: "Tokens",
        icon: "coin",
        isLive: () => isTokensEnabled() && isTokenOtcValid(),
    },
]

/** The lanes whose tab should render now (flag + realm both valid on this network). */
export function getLiveLanes(): LaneDef[] {
    return LANES.filter((l) => l.isLive())
}

/** Is a given lane live? (e.g. to guard a deep-linked lane filter.) */
export function isLaneLive(assetType: AssetType): boolean {
    const lane = LANES.find((l) => l.assetType === assetType)
    return lane ? lane.isLive() : false
}
