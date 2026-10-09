import { createContext, useContext } from "react"

/** The host currently delivers only the ready Space Invaders Free play adapter. */
export interface ArcadeLaunchIntent {
    id: string
    game: "space-invaders"
    mode: "free"
}

export interface ArcadeLaunchBridge {
    launch?: ArcadeLaunchIntent
    onLaunchConsumed?: (id: string) => void
}

/** Neutral bridge: classic game routes import no OS shell or window registry. */
export const ArcadeLaunchContext = createContext<ArcadeLaunchBridge>({})

export function useArcadeLaunchIntent(): ArcadeLaunchBridge {
    return useContext(ArcadeLaunchContext)
}
