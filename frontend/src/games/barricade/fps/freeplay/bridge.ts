import type { ReactNode } from 'react'
import type { Replay } from '../../sim/fps/types'
import { prepareFpsTerminalSnapshot, type FpsSnapshotPorts } from './terminal'

export interface FpsResultHandle { render(): ReactNode; dispose(): void }
export interface FpsFreePlayBridge { prepare(clientRunId: string, log: Replay): Promise<FpsResultHandle> }
/** Inject A's snapshot/session/result implementations once, outside React render. */
export function createFpsFreePlayBridge<T, S extends { dispose(): void }>(ports: FpsSnapshotPorts<T> & {
    createSession(snapshot: T): S
    renderSession(session: S): ReactNode
}): FpsFreePlayBridge {
    return {
        async prepare(id, log) {
            const terminal = await prepareFpsTerminalSnapshot(id, log, ports)
            // A persists first, restores consent/receipt as untrusted and owns identity invalidation.
            const session = ports.createSession(terminal.snapshot)
            return { render: () => ports.renderSession(session), dispose: () => session.dispose() }
        },
    }
}
