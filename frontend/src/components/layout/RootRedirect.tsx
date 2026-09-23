/**
 * RootRedirect — sends bare `/` to `/:network/`.
 *
 * Shares one rule with LegacyRedirect and config.ts's module load
 * (`resolveNetworkKey`): only an explicit choice is read from storage (never the
 * URL echo), and a stored network that is `hidden` is never restored, because
 * it has no option in the switcher. The redirects used to inline the rule separately and drifted — `/`
 * healed off Betanet while every bookmarked legacy URL stayed pinned to it.
 *
 * Lives beside LegacyRedirect rather than inside App.tsx so the wiring is
 * testable: nothing in the suite imports App.tsx, so a regression there was
 * invisible.
 *
 * @module components/layout/RootRedirect
 */
import { Navigate } from "react-router-dom"
import { storedNetworkKey } from "../../lib/config"

export function RootRedirect() {
    const network = storedNetworkKey()
    return <Navigate to={`/${network}/`} replace />
}
