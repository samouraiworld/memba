/**
 * Leaderboard Plugin — Entry point for member ranking.
 *
 * Registered in the plugin registry as "leaderboard".
 */

import type { PluginProps } from "../types"
import LeaderboardView from "./LeaderboardView"

export default function LeaderboardPlugin(props: PluginProps) {
    return <LeaderboardView {...props} />
}
