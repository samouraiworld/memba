import { FreePlayError, type FreePlayClient } from '../../lib/arcadeFreePlay'
import { createFreePlaySession, type FreePlaySession } from '../../games/arcade/freeplay/session'
import { loadFreePlaySnapshot, sanitizeSnapshot, persistFreePlaySnapshot, prepareFreePlayRecovery, type FreePlaySnapshot, type SnapshotStorage } from '../../games/arcade/freeplay/snapshot'

interface PublicationView { snapshot: FreePlaySnapshot; session?: FreePlaySession; ready: boolean; storageError: boolean }
/** Construction is pure. start() belongs to the mounted consumer's effect;
 * cleanup disposes its session so late responses cannot update another run.
 */
export function createBlockPartyPublication(options: { snapshot: FreePlaySnapshot; storage: SnapshotStorage; client?: FreePlayClient }) {
    const original = sanitizeSnapshot(options.snapshot)
    if (original.input.game !== 'block-party') throw new FreePlayError('invalid_snapshot')
    let view: PublicationView = { snapshot: original, ready: false, storageError: false }
    let session: FreePlaySession | undefined
    const listeners = new Set<() => void>()
    const emit = (next: PublicationView) => { view = next; for (const listener of listeners) listener() }
    return {
        getSnapshot: () => view,
        prepareRecovery() {
            try {
                const snapshot = session ? session.prepareRecovery() : prepareFreePlayRecovery(options.storage, view.snapshot)
                if (view.storageError || JSON.stringify(snapshot) !== JSON.stringify(view.snapshot)) emit({ ...view, snapshot, storageError: false })
                return snapshot
            } catch (error) { emit({ ...view, storageError: true }); throw error }
        },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        start() {
            session?.dispose(); session = undefined
            let snapshot = original
            try {
                const stored = loadFreePlaySnapshot(options.storage, original.input.clientRunId)
                if (stored) {
                    if (JSON.stringify(stored.input) !== JSON.stringify(original.input)) throw new FreePlayError('run_conflict')
                    snapshot = stored
                }
                if (options.client) session = createFreePlaySession({ snapshot, storage: options.storage, client: options.client })
                else snapshot = persistFreePlaySnapshot(options.storage, snapshot)
                emit({ snapshot, session, ready: true, storageError: false })
            } catch {
                emit({ snapshot, ready: true, storageError: true })
            }
        },
        dispose() { session?.dispose(); session = undefined },
    }
}
