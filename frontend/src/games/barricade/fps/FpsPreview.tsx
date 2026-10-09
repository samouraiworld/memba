import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useWindowActive } from '../../../os/page/WindowActivity'
import { useGameLoop } from '../hooks/useGameLoop'
import { detectHas3D } from '../render/three/caps'
import { MAGAZINE, WAVE_COUNTS } from '../sim/fps/types'
import { browserFpsStorage, createFpsRunConsumer, type FpsRunStorage } from './freeplay/consumer'
import type { FpsFreePlayBridge } from './freeplay/bridge'
import { usePreviewHeight } from './usePreviewHeight'
import './fps.css'

const Scene = lazy(() => import('../render/three/fps/FpsScene'))
class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch() { this.props.onFailure() }
    render() { return this.state.failed ? null : this.props.children }
}

export default function FpsPreview({ onClassic, freePlay, storage }: { onClassic: () => void; freePlay?: FpsFreePlayBridge; storage?: FpsRunStorage }) {
    const [consumer] = useState(() => createFpsRunConsumer({ seed: 'fps-c1-preview', storage: storage ?? browserFpsStorage(), bridge: freePlay }))
    const run = useSyncExternalStore(consumer.subscribe, consumer.getSnapshot)
    const { session } = run
    useEffect(() => consumer.mount(), [consumer])
    const hud = useSyncExternalStore(session.subscribe, session.getSnapshot)
    const [has3D] = useState(detectHas3D)
    const [failed, setFailed] = useState(false)
    const [lockHint, setLockHint] = useState('')
    const [mutedMotion, setMutedMotion] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    const [light, setLight] = useState<'dusk' | 'day'>('dusk')
    const root = usePreviewHeight()
    const viewport = useRef<HTMLDivElement>(null)
    const resume = useRef<HTMLButtonElement>(null)
    const drag = useRef<{ id: number; x: number; y: number } | null>(null)
    const active = useWindowActive()
    const { state, status } = hud
    const running = status === 'playing' && active && !failed
    useGameLoop(running, session.advance, session.frame)

    const pause = useCallback(() => {
        session.pause()
        if (document.pointerLockElement === viewport.current) document.exitPointerLock()
    }, [session])
    const fail = useCallback(() => { session.pause(); setFailed(true) }, [session])
    const ready = useCallback(() => session.setReady(), [session])

    useEffect(() => {
        const node = viewport.current
        let ownedLock = false
        const hidden = () => { if (document.hidden) pause() }
        const lockChanged = () => {
            const ownsLock = document.pointerLockElement === node
            if (ownedLock && !ownsLock && session.read().state.phase === 'wave') session.pause()
            ownedLock = ownsLock
        }
        const move = (e: MouseEvent) => {
            if (document.pointerLockElement === viewport.current) session.aim(e.movementX * 0.12, -e.movementY * 0.12)
        }
        const release = (e: PointerEvent) => { if (e.pointerType !== 'touch') session.fire(false) }
        window.addEventListener('blur', pause)
        window.addEventListener('pointerup', release)
        window.addEventListener('pointercancel', release)
        document.addEventListener('visibilitychange', hidden)
        document.addEventListener('pointerlockchange', lockChanged)
        document.addEventListener('mousemove', move)
        return () => {
            window.removeEventListener('blur', pause)
            window.removeEventListener('pointerup', release)
            window.removeEventListener('pointercancel', release)
            document.removeEventListener('visibilitychange', hidden)
            document.removeEventListener('pointerlockchange', lockChanged)
            document.removeEventListener('mousemove', move)
            if (document.pointerLockElement === node) document.exitPointerLock()
            session.clear()
        }
    }, [session, pause])
    useEffect(() => { if (!active) pause() }, [active, pause])
    useEffect(() => {
        if (status !== 'playing' || state.phase === 'repair') {
            if (document.pointerLockElement === viewport.current) document.exitPointerLock()
            if (active && !document.hidden) resume.current?.focus({ preventScroll: true })
        }
    }, [status, state.phase, active])

    function start(lock = false) {
        if (!active || document.hidden) return
        session.start()
        viewport.current?.focus({ preventScroll: true })
        // ONLY this user click handler requests capture. Rejected capture keeps drag mode.
        if (lock) {
            try {
                const request = viewport.current?.requestPointerLock?.()
                if (request) void request.catch(() => setLockHint('Capture indisponible. Glissez sur la scène pour viser.'))
                else if (!viewport.current?.requestPointerLock) setLockHint('Glissez sur la scène pour viser ; utilisez Tirer.')
            } catch { setLockHint('Capture refusée. Glissez sur la scène pour viser.') }
        }
    }
    function exportReplay() {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ ...session.log(), clientRunId: run.clientRunId })], { type: 'application/json' }))
        const a = document.createElement('a'); a.href = url; a.download = 'barricade-fps-c1-replay.json'; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const unavailable = !has3D || failed
    return <section ref={root} className="fps-preview" aria-label="Barricade FPS prototype" data-status={status} data-phase={state.phase}>
        <header className="fps-header">
            <div><span className="fps-eyebrow">BARRICADE / ÉTUDE JOUABLE C2</span><h1>Tenir la rue.</h1></div>
            <button onClick={onClassic}>Retour à Classic</button>
        </header>
        <div className="fps-hud" aria-label="État de la partie">
            <span>Barricade <strong>{state.hp}%</strong></span><span>Vague <strong>{state.wave + 1}/{WAVE_COUNTS.length}</strong></span>
            <span>Chargeur <strong>{state.reloadUntil ? 'Recharge…' : `${state.ammo}/${MAGAZINE}`}</strong></span><span>Score local <strong>{state.score}</strong></span>
        </div>
        <div className="fps-viewport" ref={viewport} tabIndex={0} aria-label="Visée FPS. Flèches pour viser, espace pour tirer, R pour recharger, P pour pause."
            onPointerDown={e => { if (document.pointerLockElement === viewport.current && e.button === 0) session.fire(true) }}
            onBlur={() => session.clear()}
            onKeyDown={e => {
                if (e.target !== e.currentTarget) return // Keep menu buttons' native keyboard activation.
                if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'r', 'p', 'escape'].includes(e.key.toLowerCase())) e.preventDefault()
                const key = e.key.toLowerCase()
                if (key === 'p' || key === 'escape') { pause(); return }
                if (status !== 'playing') return
                if (key === 'r') session.command({ type: 'reload' })
                else session.key(key, true)
            }} onKeyUp={e => session.key(e.key.toLowerCase(), false)} onContextMenu={e => e.preventDefault()}>
            {!unavailable && <SceneBoundary onFailure={fail}><Suspense fallback={<div className="fps-loading">Préparation de la rue…</div>}>
                <Scene session={session} running={running} reducedMotion={mutedMotion} light={light} onReady={ready} onFailure={fail} />
            </Suspense></SceneBoundary>}
            <div className="fps-input" aria-hidden="true"
                onPointerDown={e => {
                    if (status !== 'playing' || state.phase !== 'wave') return
                    viewport.current?.focus({ preventScroll: true })
                    if (document.pointerLockElement === viewport.current) { if (e.button === 0) session.fire(true); return }
                    if (drag.current) return
                    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={e => {
                    if (document.pointerLockElement === viewport.current || drag.current?.id !== e.pointerId) return
                    session.aim((e.clientX - drag.current.x) * 0.16, -(e.clientY - drag.current.y) * 0.16)
                    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
                }}
                onPointerUp={e => { if (drag.current?.id === e.pointerId) drag.current = null }}
                onPointerCancel={() => { drag.current = null; session.clear() }}
                onLostPointerCapture={() => { drag.current = null }} />
            {status === 'playing' && state.phase === 'wave' && !unavailable && <>
                <div className="fps-crosshair" aria-hidden="true">+</div>
                <div className="fps-axes" aria-hidden="true">↖ GAUCHE <span>↑ CENTRE</span> DROITE ↗</div>
            </>}
            {unavailable ? <div className="fps-overlay"><h2>FPS 3D indisponible</h2><p>Le prototype nécessite WebGL2. Votre partie Classic reste indépendante.</p><button onClick={onClassic}>Jouer à Classic</button></div>
                : (status === 'ready' || status === 'paused') ? <div className="fps-overlay" role={status === 'paused' ? 'dialog' : undefined} aria-label={status === 'paused' ? 'Partie en pause' : 'Prêt à jouer'}>
                    <span className="fps-eyebrow">PREMIÈRE PERSONNE · POSITION FIXE</span><h2>{status === 'paused' ? 'La rue attend.' : 'Trois axes. Une barricade.'}</h2>
                    <p className="fps-intro">Visez librement les CRS et les robots. Les boucliers bloquent les tirs : attendez leur ouverture ou visez au-dessus. Réparez entre les vagues.</p>
                    <p>Glisser ou flèches : viser · Tirer ou Espace · R : recharger · P : pause</p>
                    {hud.limited ? <p>Limite du journal atteinte. Exportez le replay et recommencez.</p> : <div className="fps-actions">
                        <button ref={resume} className="fps-primary" disabled={!hud.ready || !active} onClick={() => start()}>{hud.ready ? status === 'paused' ? 'Reprendre · visée libre' : 'Jouer · visée libre' : 'Chargement…'}</button>
                        <button disabled={!hud.ready || !active} onClick={() => start(true)}>Jouer · capturer la souris</button>
                    </div>}
                </div> : status === 'done' ? <div className="fps-overlay" role="dialog" aria-label="Résultat du prototype">
                    <h2>{state.phase === 'won' ? 'La barricade tient.' : 'La ligne a cédé.'}</h2><p>{state.score} points · {state.kills} adversaires neutralisés</p>
                    <p>{hud.verified ? 'Replay local vérifié' : 'Replay local divergent — à examiner'} · Prototype non classé</p>
                    <div className="fps-actions"><button ref={resume} className="fps-primary" onClick={() => consumer.restart()}>Rejouer le prototype</button>
                    <button onClick={exportReplay}>Exporter le replay</button></div>
                    <div className="fps-freeplay" aria-label="Conserver le résultat FPS">
                        {run.preparation === 'preparing' && <p role="status">Préparation du résultat sauvegardé…</p>}
                        {run.result?.render()}
                        {(run.storageError || run.preparation === 'unavailable') && <><p role="status">Sauvegarde ou service indisponible. Votre résultat reste ici et peut être exporté.</p><button onClick={() => consumer.retry()}>Réessayer la sauvegarde du résultat</button></>}
                    </div>
                </div> : state.phase === 'repair' ? <div className="fps-overlay fps-repair" role="dialog" aria-label="Réparer la barricade">
                    <h2>Reprenez votre souffle.</h2><p>Prochaine vague dans {Math.max(0, Math.ceil((state.repairUntil - state.tick) / 60))} s. Chargeur rempli à la reprise.</p>
                    <div className="fps-actions"><button ref={resume} className="fps-primary" disabled={!state.patchAvailable || state.hp === 100} onClick={() => session.command({ type: 'repair' })}>{state.patchAvailable ? 'Réparer +40% · une fois' : 'Réparation utilisée'}</button>
                    <button onClick={() => { session.command({ type: 'continue' }); viewport.current?.focus() }}>À la barricade</button></div>
                </div> : null}
        </div>
        <div className="fps-controls">
            <button className="fps-primary" disabled={!running || state.phase !== 'wave'}
                onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); session.fire(true) }}
                onPointerUp={() => session.fire(false)} onPointerCancel={() => session.fire(false)} onLostPointerCapture={() => session.fire(false)}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); session.fire(true) } }}
                onKeyUp={() => session.fire(false)} onBlur={() => session.fire(false)}>Tirer</button>
            <button disabled={!running || state.phase !== 'wave' || !!state.reloadUntil || state.ammo === MAGAZINE} onClick={() => session.command({ type: 'reload' })}>Recharger · R</button>
            <button disabled={!running} onClick={pause}>Pause · P</button>
            <details className="fps-settings"><summary>Réglages</summary><div className="fps-settings-panel">
            <label><input type="checkbox" checked={mutedMotion} onChange={e => setMutedMotion(e.target.checked)} /> Effets réduits</label>
            <label>Lumière <select value={light} onChange={e => setLight(e.target.value as 'dusk' | 'day')}><option value="dusk">Fin de journée</option><option value="day">Jour couvert</option></select></label>
            <p className="fps-note">Prototype non classé · Trois vagues · Réparation unique · {freePlay ? 'Sauvegarde onchain facultative en fin de partie, après vérification et confirmation.' : 'Résultat local, sans wallet ni envoi de score.'}</p>
            </div></details>
        </div>
        {lockHint && <p className="fps-notice" role="status">{lockHint}</p>}
        {run.storageError && status !== 'done' && <p className="fps-notice" role="status">Sauvegarde locale indisponible ; gardez cette fenêtre pour conserver la partie.</p>}
        <p className="fps-note fps-caption">Prototype non classé · Trois vagues · Réparation unique · Score local</p>
    </section>
}
