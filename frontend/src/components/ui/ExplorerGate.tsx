/**
 * ExplorerGate — route-level feature gate for the realm Explorer.
 *
 * Renders its children only when VITE_ENABLE_EXPLORER is on; otherwise a
 * Coming-Soon gate (mirrors FeedGate), so the page can't leak by direct URL when
 * the flag is off. VITE_ENABLE_EXPLORER is an ordinary flag — the Explorer is
 * read-only (qrender/qfile/qfuncs), moves no funds, and holds no state.
 *
 * @module components/ui/ExplorerGate
 */

import type { ReactNode } from "react"
import { isExplorerEnabled } from "../../lib/config"
import { ComingSoonGate } from "./ComingSoonGate"

export function ExplorerGate({ children }: { children: ReactNode }) {
    if (!isExplorerEnabled()) {
        return (
            <ComingSoonGate
                title="Realm Explorer"
                icon="🔎"
                description="Read any realm on gno.land from inside Memba — its live render, source, and exported functions."
                features={[
                    "View any realm's live Render() output",
                    "Browse authoritative on-chain source",
                    "See exported function signatures",
                    "Deep-linkable, read-only, no wallet needed",
                ]}
            />
        )
    }
    return <>{children}</>
}
