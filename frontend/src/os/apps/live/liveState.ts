import { createContext, useContext } from "react"
import type { ChainHealth } from "../../../hooks/home/useChainHealth"
import type { RecentActivityResult } from "../../../hooks/home/useRecentActivity"

export interface LiveState { activity: RecentActivityResult; chain: ChainHealth }
export const LiveContext = createContext<LiveState | null>(null)

export function useLiveActivity(): LiveState {
    const state = useContext(LiveContext)
    if (!state) throw new Error("Live activity requires its OS provider")
    return state
}
