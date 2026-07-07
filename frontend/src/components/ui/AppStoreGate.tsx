/**
 * AppStoreGate — route-level feature gate for the App Store.
 *
 * Renders children only when VITE_ENABLE_APPSTORE is on; otherwise a Coming-Soon
 * gate (mirrors FeedGate), so the page can't leak by direct URL when off.
 * VITE_ENABLE_APPSTORE was de-gated 2026-07-07 (memba_appstore_v2 live on test13
 * with a self-managed 2-of-2 admin + verified fee path); enabling it is a Netlify
 * flag flip, no longer blocked by the build-time safety gate.
 *
 * @module components/ui/AppStoreGate
 */

import type { ReactNode } from "react"
import { isAppStoreEnabled } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"

export function AppStoreGate({ children }: { children: ReactNode }) {
    if (!isAppStoreEnabled()) {
        return (
            <ComingSoonGate
                title="App Store"
                icon="🛍️"
                description="A curated store of gno.land dApps — discover apps, read their on-chain source, and open them."
                features={[
                    "Curated, on-chain app listings",
                    "Read the contract before you use it (Explorer)",
                    "Publish your app with a listing fee to the treasury",
                    "Community flagging + curator review",
                ]}
            />
        )
    }
    return <>{children}</>
}
