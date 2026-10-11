import { useEffect, useRef, useState } from 'react'
import { useWindowActive } from '../../../../os/page/WindowActivity'
import type { FpsResultHandle, FpsSavedResults } from './bridge'
import type { FpsRecoverySelection } from './RecoveryBoundary'

/** Controlled external recovery. No local run constructor, replay or auto readback. */
export default function SelectedResult({ selection, saved }: { selection: FpsRecoverySelection; saved?: FpsSavedResults }) {
    const active = useWindowActive()
    const close = useRef<HTMLButtonElement>(null)
    const [view, setView] = useState<{ source?: FpsSavedResults; handle?: FpsResultHandle; error?: string }>({})
    useEffect(() => { if (active && !document.hidden) close.current?.focus({ preventScroll: true }) }, [active])
    useEffect(() => {
        let handle: FpsResultHandle | undefined
        try {
            if (!saved) throw new Error('missing_fps_service')
            handle = saved.open(selection.clientRunId)
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Own and dispose the injected external session at the effect boundary.
            setView({ source: saved, handle })
        } catch (e) {
            setView({ source: saved, error: e instanceof Error ? e.message : 'unavailable' })
        }
        return () => handle?.dispose()
    }, [selection.clientRunId, saved])
    return <section role="dialog" aria-modal="true" aria-label="Résultat FPS sauvegardé" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); selection.onClose() } }}>
        <button ref={close} onClick={selection.onClose}>Fermer le résultat sauvegardé</button>
        <p>Résultat sauvegardé · {selection.clientRunId}</p>
        {view.source === saved && view.error && <p role="alert">{view.error === 'missing_fps_result' ? 'Résultat introuvable sur cet appareil.' : view.error === 'wrong_fps_result' ? 'Ce résultat ne correspond pas à cette version FPS.' : view.error === 'invalid_snapshot' ? 'Cette sauvegarde est illisible.' : 'Sauvegarde ou service indisponible. Votre partie est conservée.'}</p>}
        {view.source === saved && view.handle?.render()}
    </section>
}
