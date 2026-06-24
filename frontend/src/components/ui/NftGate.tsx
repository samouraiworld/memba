/**
 * NftGate — route-level feature gate for the NFT / launchpad / studio surface.
 *
 * Renders its children only when VITE_ENABLE_NFT is on; otherwise a Coming-Soon
 * gate. Wrapping the NFT routes here makes the "off" state authoritative at the
 * router, so a page that forgets to self-gate (the P0: collection / creator /
 * studio rendered live on-chain mint/trade UI by direct URL with the flag off)
 * can no longer leak the feature. Self-gating pages keep their extra
 * realm-validity checks as defense-in-depth.
 *
 * @module components/ui/NftGate
 */

import type { ReactNode } from "react"
import { isNftEnabled } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"

export function NftGate({ children }: { children: ReactNode }) {
    if (!isNftEnabled()) {
        return (
            <ComingSoonGate
                title="NFT Marketplace"
                icon="🎨"
                description="Mint, list, and trade GRC721 NFT collections on gno.land."
                features={[
                    "Launch a collection from the Creator Studio",
                    "Public & allowlist minting with on-chain royalties",
                    "List, buy, and make offers through the trading engine",
                    "Verified-collection badges and activity feeds",
                ]}
            />
        )
    }
    return <>{children}</>
}
