import type { ReactNode } from "react"
import { useChainHealth } from "../../../hooks/home/useChainHealth"
import { useRecentActivity } from "../../../hooks/home/useRecentActivity"
import { LiveContext } from "./liveState"

/** One polling observer for both desktop ticker and Live window. */
export function LiveActivityProvider({ networkKey, active, children }: { networkKey: string; active: boolean; children: ReactNode }) {
    const activity = useRecentActivity(networkKey, active)
    const chain = useChainHealth()
    return <LiveContext.Provider value={{ activity, chain }}>{children}</LiveContext.Provider>
}
