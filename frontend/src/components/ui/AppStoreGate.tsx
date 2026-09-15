/**
 * AppStoreGate — route-level feature gate for the App Store.
 *
 * Renders registry children only when VITE_ENABLE_APPSTORE is on. The index
 * remains a static ecosystem directory; nested registry routes stay gated.
 * VITE_ENABLE_APPSTORE was de-gated 2026-07-07 (memba_appstore_v2 live on test13
 * with a self-managed 2-of-2 admin + verified fee path); enabling it is a Netlify
 * flag flip, no longer blocked by the build-time safety gate.
 *
 * @module components/ui/AppStoreGate
 */

import type { ReactNode } from "react"
import { isAppStoreEnabled } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"
import { useLocation, useParams } from "react-router-dom"
import { EcosystemDirectory } from "../appstore/EcosystemDirectory"

export function AppStoreGate({ children }: { children: ReactNode }) {
    const { pathname } = useLocation()
    const { network } = useParams()
    if (!isAppStoreEnabled()) {
        // A public directory does not mount any gated registry or wallet flow.
        if (pathname.replace(/\/$/, "") === `/${network}/apps`) return <EcosystemDirectory standalone />
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
