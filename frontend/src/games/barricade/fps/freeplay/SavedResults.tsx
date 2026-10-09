import { useEffect, useId, useRef, useState } from 'react'
import type { FpsResultHandle, FpsSavedResults } from './bridge'

const errors: Record<string, string> = {
    invalid_fps_run_id: 'Identifiant invalide.', missing_fps_result: 'Résultat introuvable sur cet appareil.',
    wrong_fps_result: 'Ce résultat ne correspond pas à cette version FPS.',
    invalid_snapshot: 'Cette sauvegarde est illisible.', invalid_snapshot_index: 'La liste des sauvegardes est illisible ; essayez un identifiant.',
}
/** Local browse only. A owns the index, canonical records and explicit network actions. */
export function SavedResults({ saved }: { saved: FpsSavedResults }) {
    const inputId = useId(), current = useRef<FpsResultHandle | null>(null)
    const [visible, setVisible] = useState(false), [id, setId] = useState('')
    const [page, setPage] = useState<ReturnType<FpsSavedResults['list']>>()
    const [error, setError] = useState(''), [result, setResult] = useState<FpsResultHandle | null>(null)
    useEffect(() => () => { current.current?.dispose(); current.current = null }, [saved])
    function failure(e: unknown) { setError(errors[e instanceof Error ? e.message : ''] ?? 'Stockage ou service indisponible. La partie courante est conservée.') }
    function list() {
        setVisible(true); setError('')
        try { setPage(saved.list()) } catch (e) { setPage(undefined); failure(e) }
    }
    function open(runId: string) {
        setError('')
        try {
            const next = saved.open(runId.trim())
            current.current?.dispose(); current.current = next; setResult(next); setId(runId)
        } catch (e) { failure(e) }
    }
    function close() { current.current?.dispose(); current.current = null; setResult(null); setVisible(false) }
    return <div className="fps-freeplay fps-saved">
        {!visible ? <button onClick={list}>Résultats sauvegardés</button> : <section aria-label="Résultats FPS sauvegardés">
            <button onClick={close}>Fermer les sauvegardes</button>
            <p>Résultats conservés sur cet appareil. Ouvrir ne relance pas la partie.</p>
            <form onSubmit={e => { e.preventDefault(); open(id) }}>
                <label htmlFor={inputId}>Identifiant du résultat</label>
                <input id={inputId} value={id} onChange={e => setId(e.target.value)} maxLength={36} autoCapitalize="none" spellCheck={false} />
                <button type="submit">Ouvrir ce résultat</button>
            </form>
            <button onClick={list}>Actualiser la liste locale</button>
            {page && <>
                {!page.runs.length && <p>Aucun résultat FPS récent.</p>}
                {page.unavailable > 0 && <p role="status">{page.unavailable} sauvegarde(s) récente(s) indisponible(s).</p>}
                <ul>{page.runs.map(run => <li key={run.clientRunId}><button onClick={() => open(run.clientRunId)}>{run.score} points · {run.clientRunId}</button></li>)}</ul>
            </>}
            {error && <p role="alert">{error}</p>}
            {result?.render()}
        </section>}
    </div>
}
