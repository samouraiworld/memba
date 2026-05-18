/**
 * GnoloveTeamProfile — picks between the Phase 4 hub and the legacy stub.
 *
 * The hub renders when:
 *   1. `VITE_GNOLOVE_TEAM_HUB` build-time flag is on, AND
 *   2. {@link useGnoloveBackendHealth} hasn't reported the backend as down
 *      (auto-degrade after 2× HEAD failure in 30s — plan R-4).
 *
 * Otherwise the legacy stub renders. The two paths share `:teamName`
 * as their URL parameter so existing shareable links keep working
 * unchanged through the flag flip.
 *
 * @module pages/gnolove/GnoloveTeamProfile
 */

import { TeamHub } from "../../components/gnolove/teams/TeamHub"
import GnoloveTeamProfileLegacy from "./GnoloveTeamProfileLegacy"
import { useGnoloveBackendHealth } from "../../hooks/gnolove"
import { isTeamHubEnabled } from "../../lib/gnoloveFeatureFlags"

export default function GnoloveTeamProfile() {
    const hubEnabled = isTeamHubEnabled()
    // Only probe when the flag is on — no point burning HEAD requests on the
    // legacy path. The hook returns "unknown" immediately when `enabled=false`.
    const health = useGnoloveBackendHealth({ enabled: hubEnabled })

    if (!hubEnabled || health === "down") {
        return <GnoloveTeamProfileLegacy />
    }
    return <TeamHub />
}
