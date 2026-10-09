import type { ReactNode } from 'react'
import { FPS_RULESET, FPS_VERSION, type Replay } from '../../sim/fps/types'
import { prepareFpsTerminalSnapshot, type FpsSnapshotPorts } from './terminal'

export interface FpsResultHandle { render(): ReactNode; dispose(): void }
interface SavedInput { clientRunId: string; game: string; rules: string; simVersion: number; claimedScore: number }
export interface FpsSavedResults {
    list(): { runs: { clientRunId: string; score: number }[]; unavailable: number }
    open(clientRunId: string): FpsResultHandle
}
export interface FpsFreePlayBridge {
    prepare(clientRunId: string, log: Replay): Promise<FpsResultHandle>
    saved?: FpsSavedResults
}
/** Inject A's snapshot/session/result implementations once, outside React render. */
export function createFpsFreePlayBridge<T extends { input: SavedInput }, S extends { dispose(): void }>(ports: FpsSnapshotPorts<T> & {
    createSession(snapshot: T): S
    renderSession(session: S): ReactNode
    savedSnapshots?: {
        /** Inject listFreePlaySnapshots(storage, { game: 'barricade', offset: 0, limit: 20 }). */
        list(): { snapshots: T[]; unavailable: number }
        /** Inject loadFreePlaySnapshot(storage, id); this is A's canonical record. */
        load(clientRunId: string): T | null
    }
}): FpsFreePlayBridge {
    function openSnapshot(snapshot: T): FpsResultHandle {
        // A persists first, restores consent/receipt as untrusted and owns identity invalidation.
        const session = ports.createSession(snapshot)
        return { render: () => ports.renderSession(session), dispose: () => session.dispose() }
    }
    const fps = (s: T) => s.input.game === 'barricade' && s.input.rules === FPS_RULESET && s.input.simVersion === FPS_VERSION
    return {
        async prepare(id, log) {
            const terminal = await prepareFpsTerminalSnapshot(id, log, ports)
            return openSnapshot(terminal.snapshot)
        },
        ...(ports.savedSnapshots ? { saved: {
            list() {
                const page = ports.savedSnapshots!.list()
                return { runs: page.snapshots.filter(fps).map(s => ({ clientRunId: s.input.clientRunId, score: s.input.claimedScore })), unavailable: page.unavailable }
            },
            open(id: string) {
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('invalid_fps_run_id')
                const snapshot = ports.savedSnapshots!.load(id)
                if (!snapshot) throw new Error('missing_fps_result')
                if (snapshot.input.clientRunId !== id || !fps(snapshot)) throw new Error('wrong_fps_result')
                // Recovery never hashes, replays, or constructs a gameplay session.
                return openSnapshot(snapshot)
            },
        } } : {}),
    }
}
