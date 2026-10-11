import { createContext, useContext } from 'react'
import type { FreePlayClient, FreePlayGame, FreePlayTarget } from '../../../lib/arcadeFreePlay'
import type { SnapshotStorage } from './snapshot'

/** Stable, configured dependencies owned by the OS. No endpoint or network defaults. */
export interface FreePlayGameRuntime {
    client?: FreePlayClient
    target?: FreePlayTarget
    storage: SnapshotStorage
    connect?: () => void | Promise<void>
    rules: string
    simVersion: number
}
export interface FreePlayRecovery {
    game: FreePlayGame
    clientRunId: string
    onClose(): void
}
export interface FreePlayRuntime {
    games: Partial<Record<FreePlayGame, FreePlayGameRuntime>>
    recovery?: FreePlayRecovery
    subscribeSavedRuns?: (refresh: () => void) => () => void
}
export const FreePlayRuntimeContext = createContext<FreePlayRuntime | null>(null)

export function useFreePlayRuntime(): FreePlayRuntime | null { return useContext(FreePlayRuntimeContext) }
