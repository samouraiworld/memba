/**
 * FeedGate — route-level feature gate for the social feed surface.
 *
 * Renders its children only when VITE_ENABLE_FEED is on; otherwise a
 * Coming-Soon gate. Wrapping the /feed route here makes the "off" state
 * authoritative at the router (mirrors NftGate), so a page can't leak the
 * feature by direct URL when the flag is off. VITE_ENABLE_FEED is an ordinary
 * flag — the feed moves no funds.
 *
 * @module components/ui/FeedGate
 */

import type { ReactNode } from "react"
import { isFeedEnabled } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"

export function FeedGate({ children }: { children: ReactNode }) {
    if (!isFeedEnabled()) {
        return (
            <ComingSoonGate
                title="Social Feed"
                icon="📣"
                description="A global, on-chain social feed for the Memba community — post, reply, and discuss, all on gno.land."
                features={[
                    "Post and reply on-chain, no gatekeepers",
                    "A single global timeline for the community",
                    "Flag posts for operator review",
                    "Rich on-chain unfurls — proposals, tokens, validators",
                ]}
            />
        )
    }
    return <>{children}</>
}
