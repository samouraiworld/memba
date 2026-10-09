import { createSession, type Session } from '../session'
import { type Replay } from '../../sim/fps/types'
import type { FpsFreePlayBridge, FpsResultHandle } from './bridge'

export interface FpsRunStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const FPS_ACTIVE_RUN = 'memba:barricade:fps:active:v1'
const localKey = (id: string) => `memba:barricade:fps:local:v1:${id}`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type ConsumerView = { session: Session; clientRunId: string; storageError: boolean; preparation: 'local' | 'preparing' | 'ready' | 'unavailable'; result?: FpsResultHandle }
export interface FpsConsumerOptions { seed: string; storage?: FpsRunStorage; bridge?: FpsFreePlayBridge; uuid?: () => string }

/** Game-owned checkpoint and session lifecycle only. A alone owns publication persistence/I/O. */
export function createFpsRunConsumer(options: FpsConsumerOptions) {
    const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID())
    const listeners = new Set<() => void>()
    let storageError = false, restored: { id: string; log: Replay } | undefined
    try {
        const id = options.storage?.getItem(FPS_ACTIVE_RUN)
        if (id) {
            if (!uuidPattern.test(id)) throw new Error('invalid_local_identity')
            const raw = options.storage!.getItem(localKey(id))
            if (!raw || raw.length > 1_100_000) throw new Error('invalid_local_run')
            const saved = JSON.parse(raw)
            if (saved.schema !== 1 || saved.clientRunId !== id || saved.log?.seed !== options.seed) throw new Error('invalid_local_run')
            // Session validates accepted input and resumes paused, never auto-plays.
            restored = { id, log: saved.log }
            createSession(options.seed, restored.log)
        }
    } catch { storageError = true; restored = undefined }
    const freshId = () => { const id = uuid(); if (!uuidPattern.test(id)) throw new Error('invalid_fps_run_id'); return id }
    let session = createSession(options.seed, restored?.log), clientRunId = restored?.id ?? freshId()
    let view: ConsumerView = { session, clientRunId, storageError, preparation: 'local' }
    let active = false, generation = 0, unsubscribe: (() => void) | undefined
    let checkpoint = -60, checkpointStatus = '', handle: FpsResultHandle | undefined
    let bridge = options.bridge
    let terminalLog: Replay | undefined
    const emit = (next: Partial<ConsumerView>) => { view = { ...view, ...next }; listeners.forEach(fn => fn()) }
    function persist(force = false): boolean {
        const { state, status } = session.getSnapshot()
        if (!force && state.tick - checkpoint < 60 && status === checkpointStatus) return !view.storageError
        const log = session.log()
        // Accepted pointer commands may be pending at the current tick. Checkpoint after
        // advance consumes that tick, never invent an extra tick or drop pending actions.
        if (log.events.some(e => e.tick >= log.finalTick)) return !view.storageError
        try {
            if (!options.storage) throw new Error('storage_unavailable')
            options.storage.setItem(localKey(clientRunId), JSON.stringify({ schema: 1, clientRunId, log }))
            options.storage.setItem(FPS_ACTIVE_RUN, clientRunId)
            checkpoint = state.tick; checkpointStatus = status
            if (view.storageError) emit({ storageError: false })
            return true
        } catch { if (!view.storageError) emit({ storageError: true }); return false }
    }
    function prepare() {
        if (!active || !bridge || session.getSnapshot().status !== 'done' || view.preparation === 'preparing' || handle) return
        terminalLog ??= session.log()
        if (!persist(true)) { emit({ preparation: 'unavailable' }); return }
        const epoch = generation, id = clientRunId
        emit({ preparation: 'preparing' })
        let pending: Promise<FpsResultHandle>
        try { pending = bridge.prepare(id, terminalLog) }
        catch { emit({ preparation: 'unavailable' }); return }
        void pending.then(result => {
            if (!active || generation !== epoch || clientRunId !== id) { result.dispose(); return }
            handle = result; emit({ result, preparation: 'ready' })
        }).catch(() => { if (active && generation === epoch) emit({ preparation: 'unavailable' }) })
    }
    function observe() { persist(); if (session.getSnapshot().status === 'done' && view.preparation === 'local') prepare() }
    function detach() {
        active = false; generation++; unsubscribe?.(); unsubscribe = undefined
        session.pause(); session.clear(); persist(true)
        handle?.dispose(); handle = undefined
        emit({ result: undefined, preparation: 'local' })
    }
    return {
        getSnapshot: () => view,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
        mount() {
            if (active) return detach
            active = true; generation++; unsubscribe = session.subscribe(observe)
            persist(true); observe()
            return detach
        },
        setBridge(next: FpsFreePlayBridge | undefined) {
            if (next === bridge) return
            bridge = next; generation++
            handle?.dispose(); handle = undefined
            emit({ result: undefined, preparation: 'local' })
            prepare() // A new provider may retain the same result; never starts or replaces gameplay.
        },
        retry() { if (!active) return; persist(true); prepare() },
        restart() {
            const mounted = active
            detach()
            clientRunId = freshId(); session = createSession(options.seed); terminalLog = undefined; checkpoint = -60; checkpointStatus = ''
            emit({ session, clientRunId, result: undefined, preparation: 'local' })
            if (mounted) { active = true; generation++; unsubscribe = session.subscribe(observe); persist(true) }
        },
    }
}

/** Construct lazily in the component: no module-level storage access or identity. */
export function browserFpsStorage(): FpsRunStorage | undefined {
    try { return globalThis.localStorage } catch { return undefined }
}
