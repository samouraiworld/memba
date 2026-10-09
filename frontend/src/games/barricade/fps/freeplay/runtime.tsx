// Shared A8 dependency: 35c9e9205bb7726e7a47ef913908296cff0de2e2. No endpoint/client defaults.
import { useMemo } from 'react'
import { hashFreePlayFields, FreePlayError } from '../../../../lib/arcadeFreePlay'
import { useFreePlayRuntime, type FreePlayGameRuntime } from '../../../arcade/freeplay/FreePlayRuntimeContext'
import { createFreePlaySnapshot, prepareFreePlayRecovery, listFreePlaySnapshots, loadFreePlaySnapshot } from '../../../arcade/freeplay/snapshot'
import { createFreePlaySession } from '../../../arcade/freeplay/session'
import { FreePlayResult } from '../../../arcade/freeplay/FreePlayResult'
import { FreePlayConnect } from '../../../arcade/freeplay/FreePlayConnect'
import LocalResult from './LocalResult'
import { createFpsFreePlayBridge, type FpsFreePlayBridge } from './bridge'
import type { FpsRecoverySelection } from './RecoveryBoundary'

export function makeFpsRuntimeBridge(config: FreePlayGameRuntime): FpsFreePlayBridge | undefined {
    if (config.rules !== 'barricade-fps-c1' || config.simVersion !== 3) return undefined
    return createFpsFreePlayBridge({
        hashFields: hashFreePlayFields, createSnapshot: createFreePlaySnapshot,
        createSession(snapshot) {
            let shared: ReturnType<typeof createFreePlaySession> | undefined
            let recoveryReady = false, disposed = false
            // A fresh terminal snapshot has no binding/consent. Retain A's
            // readable canonical record before a write/index failure can hide
            // it from the guard's return value. This is an export source only:
            // the shared guard below still decides conflicts and durability.
            // Already-bound snapshots never adopt another identity here.
            if (!snapshot.binding && !snapshot.publication) {
                try {
                    const retained = loadFreePlaySnapshot(config.storage, snapshot.input.clientRunId)
                    if (retained && JSON.stringify(retained.input) === JSON.stringify(snapshot.input)) snapshot = retained
                } catch { /* The shared guard classifies unreadable storage below. */ }
            }
            // A is the only authority for canonical/index readback and retained
            // binding/consent. Never infer durability from the FPS checkpoint.
            const prepareRecovery = () => {
                if (disposed) throw new FreePlayError('recovery_unavailable')
                snapshot = prepareFreePlayRecovery(config.storage, snapshot)
                return snapshot
            }
            try {
                prepareRecovery()
                if (config.client) shared = createFreePlaySession({ snapshot, client: config.client, storage: config.storage })
                recoveryReady = true
            } catch (error) {
                // A storage failure still exposes the completed snapshot/export.
                // Conflicts are not converted into a new identity or binding.
                if (!(error instanceof FreePlayError) || error.code !== 'storage_unavailable') throw error
            }
            return { snapshot, shared, recoveryReady, prepareRecovery, dispose() { disposed = true; shared?.dispose() } }
        },
        renderSession: handle => handle.shared
            ? <FreePlayResult session={handle.shared} connect={config.connect} />
            : <LocalResult snapshot={handle.snapshot} recoveryReady={handle.recoveryReady} connection={config.connect
                ? <FreePlayConnect snapshot={handle.snapshot} prepare={handle.prepareRecovery} connect={config.connect} /> : undefined} />,
        savedSnapshots: {
            list: () => listFreePlaySnapshots(config.storage, { game: 'barricade', offset: 0, limit: 20 }),
            load: id => loadFreePlaySnapshot(config.storage, id),
        },
    })
}
/** Provider objects/client/storage must be stable for the mounted game, per A3. */
export function useFpsRuntime(explicit: { fpsFreePlay?: FpsFreePlayBridge | null; recovery?: FpsRecoverySelection | null }) {
    const runtime = useFreePlayRuntime(), config = runtime?.games.barricade
    const fallback = useMemo(() => config ? makeFpsRuntimeBridge(config) : undefined, [config])
    return {
        fpsFreePlay: explicit.fpsFreePlay !== undefined ? explicit.fpsFreePlay : fallback,
        // Archive selection is window-local (Arcade > Your runs), never global.
        recovery: explicit.recovery,
    }
}
