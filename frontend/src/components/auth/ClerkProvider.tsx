/**
 * ClerkProvider — Lazy-loaded Clerk auth wrapper for alerting & gnolove features.
 *
 * This component is ONLY dynamically imported by AlertsPage.tsx via React.lazy().
 * The ~45KB @clerk/clerk-react bundle is tree-shaken from the main chunk.
 *
 * One production instance, no satellite mode. Its frontend host (clerk.<primary
 * domain>) and accounts host must be in the CSP (netlify.toml, index.html).
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
    /** Shown instead when this build has no Clerk key (nobody can sign in). */
    fallback?: ReactNode
}

export default function ClerkProvider({ children, fallback = null }: Props) {
    if (!CLERK_PUBLISHABLE_KEY) return fallback

    return (
        <ClerkReactProvider
            publishableKey={CLERK_PUBLISHABLE_KEY}
            appearance={{ baseTheme: dark }}
        >
            {children}
        </ClerkReactProvider>
    )
}
