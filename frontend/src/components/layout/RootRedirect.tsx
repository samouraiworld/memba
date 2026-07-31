/**
 * RootRedirect — sends bare `/` to `/:network/`.
 *
 * Shares one rule with LegacyRedirect (`resolveStoredNetworkKey`): a stored
 * network that is `hidden` must not be restored, because it has no option in the
 * switcher. The two used to inline the rule separately and drifted — `/` healed
 * off Betanet while every bookmarked legacy URL stayed pinned to it.
 *
 * Lives beside LegacyRedirect rather than inside App.tsx so the wiring is
 * testable: nothing in the suite imports App.tsx, so a regression there was
 * invisible.
 *
 * @module components/layout/RootRedirect
 */
import { Navigate } from "react-router-dom"
import { resolveStoredNetworkKey } from "../../lib/config"

export function RootRedirect() {
    // Self-heals away from a hidden network — see resolveStoredNetworkKey.
    const network = resolveStoredNetworkKey(localStorage.getItem("memba_network"))
    return <Navigate to={`/${network}/`} replace />
}
