import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { sanitizeSnapshot, type FreePlaySnapshot } from './snapshot'
type Phase = 'checking' | 'ready' | 'storage-error' | 'connecting' | 'connect-error'
interface State { prepare: () => FreePlaySnapshot; id: string; saved: FreePlaySnapshot; phase: Phase }

/** prepare calls the shared local recovery guard and stays stable per run.
 * No connect on mount, no API, no claim of resuming an unfinished engine.
 */
export function FreePlayConnect({ snapshot, prepare, connect, disabled = false }: {
    snapshot: FreePlaySnapshot
    disabled?: boolean
    prepare: () => FreePlaySnapshot
    connect: () => void | Promise<void>
}) {
    const fallback = useMemo(() => sanitizeSnapshot(snapshot), [snapshot])
    const latestFallback = useRef(fallback)
    useLayoutEffect(() => { latestFallback.current = fallback }, [fallback])
    const id = fallback.input.clientRunId
    const [state, setState] = useState<State>({ prepare, id, saved: fallback, phase: 'checking' })
    // Mask the previous owner's notice/export synchronously, before effects.
    const current: State = state.prepare === prepare && state.id === id ? state : { prepare, id, saved: fallback, phase: 'checking' }
    const busy = useRef(false)
    const lifetime = useRef(0)
    useEffect(() => {
        lifetime.current++
        let next: State
        try { next = { prepare, id, saved: prepare(), phase: 'ready' } }
        catch { next = { prepare, id, saved: latestFallback.current, phase: 'storage-error' } }
        setState(next)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- generation counter, not a DOM ref: cleanup intentionally invalidates the current lifetime.
        return () => { lifetime.current++ }
    }, [prepare, id])
    const start = async () => {
        if (busy.current || disabled) return
        let saved: FreePlaySnapshot
        try { saved = prepare() }
        catch { setState({ prepare, id, saved: fallback, phase: 'storage-error' }); return }
        const epoch = lifetime.current
        busy.current = true; setState({ prepare, id, saved, phase: 'connecting' })
        const finish = (phase: Phase) => {
            if (lifetime.current !== epoch) return
            setState(previous => previous.prepare === prepare && previous.id === id ? { ...previous, phase } : previous)
        }
        try { await connect(); finish('ready') }
        catch { finish('connect-error') }
        finally { busy.current = false }
    }
    return <div>
        {current.phase === 'checking' && <p role="status">Checking this completed result is saved…</p>}
        {current.phase === 'storage-error' ? <>
            <p role="alert">This completed result could not be saved for recovery. Export it before leaving.</p>
            <details><summary>Export completed result</summary><textarea aria-label="Completed result export" readOnly value={JSON.stringify(current.saved, null, 2)} /></details>
        </> : <>
            {current.phase !== 'checking' && <p>After connecting, find this completed result in Arcade → Your runs.</p>}
            <button type="button" disabled={disabled || current.phase === 'checking' || current.phase === 'connecting'} onClick={() => void start()}>Connect wallet for saved scores</button>
            {current.phase === 'connect-error' && <p role="alert">Connection did not complete. Find this completed result in Arcade → Your runs.</p>}
        </>}
    </div>
}
