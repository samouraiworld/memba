/**
 * navFlags — single source of truth for resolving a nav entry's env flag to a
 * boolean, shared by the desktop Sidebar and the mobile tab bar's More sheet.
 *
 * Flag state MUST come from LITERAL import.meta.env accesses (the config.ts
 * readers) — Vite only statically replaces literals; the dynamic
 * `import.meta.env[name]` fallback object carries NO VITE_ keys in production
 * builds, which would badge a LIVE feature as "soon". Keep every flagged nav
 * entry mapped here.
 *
 * @module lib/navFlags
 */
import { isNftEnabled, isServicesEnabled, isMarketplaceEnabled, isFeedEnabled, isExplorerEnabled, isAppStoreEnabled } from "./config"

const FLAG_READERS: Record<string, () => boolean> = {
    VITE_ENABLE_MARKETPLACE: isMarketplaceEnabled,
    VITE_ENABLE_SERVICES: isServicesEnabled,
    VITE_ENABLE_NFT: isNftEnabled,
    VITE_ENABLE_FEED: isFeedEnabled,
    VITE_ENABLE_EXPLORER: isExplorerEnabled,
    VITE_ENABLE_APPSTORE: isAppStoreEnabled,
}

/** True when the entry has no flag (always on) or its flag reader returns true. */
export function navFlagOn(flag?: string): boolean {
    if (!flag) return true
    return FLAG_READERS[flag]?.() ?? false
}
