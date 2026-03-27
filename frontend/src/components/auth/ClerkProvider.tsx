/**
 * ClerkProvider — Lazy-loaded Clerk auth wrapper for the alerting feature.
 *
 * This component is ONLY dynamically imported by AlertsPage.tsx via React.lazy().
 * The ~45KB @clerk/clerk-react bundle is tree-shaken from the main chunk.
 *
 * Security: Clerk publishable key is public by design. JWTs are validated
 * server-side by gnomonitoring's clerk-sdk-go middleware.
 *
 * @module components/auth/ClerkProvider
 */

import { ClerkProvider as ClerkReactProvider } from "@clerk/clerk-react"
import { dark } from "@clerk/themes"
import { CLERK_PUBLISHABLE_KEY } from "../../lib/config"
import type { ReactNode } from "react"

interface Props {
    children: ReactNode
}

export default function ClerkProvider({ children }: Props) {
    if (!CLERK_PUBLISHABLE_KEY) {
        return (
            <div style={{
                padding: 24, borderRadius: 12,
                background: "rgba(255,165,0,0.06)",
                border: "1px solid rgba(255,165,0,0.15)",
                color: "#ffa500", fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
                textAlign: "center",
            }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Alerting auth not configured</p>
                <p style={{ color: "#888", fontSize: 11 }}>
                    Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to enable alerting features.
                </p>
            </div>
        )
    }

    return (
        <ClerkReactProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            appearance={{ baseTheme: dark }}
        >
            {children}
        </ClerkReactProvider>
    )
}
