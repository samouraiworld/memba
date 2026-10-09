import { FreePlayError, type FreePlayClient, type FreePlayQuote, type FreePlayRun } from '../../../lib/arcadeFreePlay'
import { sanitizeSnapshot, saveFreePlaySnapshot, loadFreePlaySnapshot, snapshotRun, type FreePlaySnapshot, type SnapshotStorage } from './snapshot'

export interface FreePlayView {
    snapshot: FreePlaySnapshot
    phase: 'saved' | 'busy' | 'verified' | 'quoted' | 'pending' | 'confirmed' | 'error'
    quote?: FreePlayQuote
    error?: string
    nextCheckAt?: number
}
/** One controller per immutable completed run. There is no global current run. */
export function createFreePlaySession(options: { snapshot: FreePlaySnapshot; client: FreePlayClient; storage: SnapshotStorage; now?: () => number }) {
    const now = options.now ?? (() => Math.floor(Date.now() / 1000))
    const initial = sanitizeSnapshot(options.snapshot)
    const stored = loadFreePlaySnapshot(options.storage, initial.input.clientRunId)
    if (stored && JSON.stringify(stored.input) !== JSON.stringify(initial.input)) throw new FreePlayError('run_conflict')
    const freeze = (snapshot: FreePlaySnapshot) => {
        const deepFreeze = (v: object) => { for (const child of Object.values(v)) if (child && typeof child === 'object') deepFreeze(child); Object.freeze(v) }
        deepFreeze(snapshot)
        return snapshot
    }
    saveFreePlaySnapshot(options.storage, stored ?? initial)
    let view: FreePlayView = { snapshot: freeze(stored ?? initial), phase: 'saved' }
    let generation = 0
    let active: AbortController | undefined
    let disposed = false
    const listeners = new Set<() => void>()
    const emit = (next: FreePlayView) => { view = next; for (const listener of listeners) listener() }
    const persist = (snapshot: FreePlaySnapshot) => {
        const clean = sanitizeSnapshot(snapshot)
        saveFreePlaySnapshot(options.storage, clean)
        return freeze(clean)
    }
    const applyRun = (run: FreePlayRun) => {
        const snapshot = persist({ ...view.snapshot, result: run })
        emit({ snapshot, phase: run.status === 'confirmed' ? 'confirmed' : run.status === 'verified' ? 'verified' : 'pending', nextCheckAt: run.nextCheckAt, error: run.lastError })
    }
    async function operate(action: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
        if (disposed || active) return
        const controller = new AbortController()
        active = controller
        const epoch = ++generation
        const current = () => !disposed && generation === epoch && !controller.signal.aborted
        emit({ ...view, phase: 'busy', error: undefined })
        try { await action(controller.signal, current) }
        catch (error) { if (current()) emit({ snapshot: view.snapshot, phase: 'error', error: error instanceof FreePlayError ? error.code : 'service_unavailable' }) }
        finally { if (generation === epoch) active = undefined }
    }
    function binding() {
        if (view.snapshot.binding) return view.snapshot.binding
        const snapshot = persist({ ...view.snapshot, binding: options.client.bind() })
        emit({ ...view, snapshot })
        return snapshot.binding!
    }
    function invalidate() { generation++; active?.abort(); active = undefined; emit({ snapshot: view.snapshot, phase: 'saved' }) }
    const unsubscribeIdentity = options.client.subscribeIdentity(invalidate)
    return {
        getSnapshot: () => view,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        /** Aborts callbacks on wallet/network changes or when the owner is disposed. */
        invalidate,
        dispose() { unsubscribeIdentity(); disposed = true; generation++; active?.abort(); active = undefined; listeners.clear() },
        verify() { return operate(async (signal, current) => { const run = await options.client.verify(binding(), view.snapshot.input, signal); if (current()) applyRun(run) }) },
        refresh() { return operate(async (signal, current) => { const run = await options.client.read(binding(), view.snapshot.input, signal); if (current()) applyRun(run) }) },
        quote() {
            return operate(async (signal, current) => {
                const bound = binding()
                // Never authorize a stored receipt/score without a fresh authenticated read.
                const run = await options.client.read(bound, view.snapshot.input, signal)
                if (!current()) return
                if (run.status !== 'verified') { applyRun(run); return }
                emit({ snapshot: persist({ ...view.snapshot, result: run }), phase: 'busy' })
                const quote = await options.client.quote(bound, view.snapshot.input, run, signal)
                if (current()) emit({ snapshot: view.snapshot, phase: 'quoted', quote })
            })
        },
        /** Call only from explicit user consent after displaying this exact quote. */
        publish() {
            const quote = view.quote
            if (!quote || view.phase !== 'quoted') return Promise.resolve()
            return operate(async (signal, current) => {
                if (quote.expiresAt <= now()) throw new FreePlayError('quote_expired')
                const run = snapshotRun(view.snapshot)
                if (!run || quote.runID !== run.entry.runID || quote.payloadHash !== run.payloadHash) throw new FreePlayError('run_conflict')
                const publication = { payloadHash: quote.payloadHash, quoteId: quote.quoteId, nonce: quote.nonce }
                // Persist consent before I/O. On an ambiguous failure/reload, retry
                // exactly this request; never obtain a new quote automatically.
                const snapshot = persist({ ...view.snapshot, publication })
                emit({ ...view, snapshot })
                const result = await options.client.publish(binding(), snapshot.input, publication, signal)
                if (current()) applyRun(result)
            })
        },
        retryPublication() {
            return operate(async (signal, current) => {
                const snapshot = view.snapshot
                if (!snapshot.publication || !snapshot.binding) throw new FreePlayError('missing_publication')
                const run = await options.client.publish(snapshot.binding, snapshot.input, snapshot.publication, signal)
                if (current()) applyRun(run)
            })
        },
    }
}
export type FreePlaySession = ReturnType<typeof createFreePlaySession>
