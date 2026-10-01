import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { isWalletRequestPending, subscribeWalletActivity } from '../lib/walletActivity'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
const ACTIVATION_TIMEOUT_MS = 15_000

/** A new worker may install while an old tab has unsaved work. Only a click reloads it. */
export function UpdateNotice() {
    const [ready, setReady] = useState(false)
    const [activating, setActivating] = useState(false)
    const [activationFailed, setActivationFailed] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const walletPending = useSyncExternalStore(subscribeWalletActivity, isWalletRequestPending)
    const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
    const newWorkerControlsPage = useRef(false)
    const reloadRequested = useRef(false)
    /** Ends the wait a click started: its statechange listener and its timeout. */
    const stopWaiting = useRef(() => {})

    // The controller change and the worker's "activated" state may both answer one click: whichever comes
    // first reloads, once, unless a wallet request began meanwhile.
    const finishActivation = useCallback(() => {
        stopWaiting.current()
        setActivating(false)
        const go = reloadRequested.current && !isWalletRequestPending()
        reloadRequested.current = false
        if (go) window.location.reload()
    }, [])

    useEffect(() => {
        let mounted = true
        const checkForUpdate = () => {
            const current = registration.current
            if (!current || current.installing || !navigator.onLine || document.visibilityState !== 'visible') return
            void current.update().catch(() => { /* Retry on the next focus or interval. */ })
        }

        registerSW({
            immediate: true,
            onNeedRefresh() {
                if (mounted) setReady(true)
            },
            onNeedReload() {
                newWorkerControlsPage.current = true
                if (!mounted) return
                setReady(true)
                finishActivation()
            },
            onRegisteredSW(_url, workerRegistration) {
                registration.current = workerRegistration
            },
        })

        window.addEventListener('focus', checkForUpdate)
        window.addEventListener('online', checkForUpdate)
        document.addEventListener('visibilitychange', checkForUpdate)
        const interval = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)
        return () => {
            mounted = false
            stopWaiting.current()
            window.clearInterval(interval)
            window.removeEventListener('focus', checkForUpdate)
            window.removeEventListener('online', checkForUpdate)
            document.removeEventListener('visibilitychange', checkForUpdate)
        }
    }, [finishActivation])

    const reload = () => {
        if (isWalletRequestPending() || activating) return
        setActivationFailed(false)
        const waiting = registration.current?.waiting
        // Nothing waits: the newest worker is already active (an earlier click, another tab), and a normal
        // reload loads it. A page opened by a hard reload has no controller, so it never sees the switch itself.
        if (newWorkerControlsPage.current || !waiting) {
            window.location.reload()
            return
        }
        reloadRequested.current = true
        setActivating(true)
        const stateChanged = () => {
            if (waiting.state === 'activated') finishActivation()
        }
        const timer = window.setTimeout(() => {
            stopWaiting.current()
            reloadRequested.current = false
            setActivating(false)
            setActivationFailed(true)
        }, ACTIVATION_TIMEOUT_MS)
        waiting.addEventListener('statechange', stateChanged)
        stopWaiting.current = () => {
            waiting.removeEventListener('statechange', stateChanged)
            window.clearTimeout(timer)
        }
        waiting.postMessage({ type: 'SKIP_WAITING' })
    }

    if (!ready) return null
    if (collapsed) return <button type="button" className="memba-update-mini" onClick={() => setCollapsed(false)}>● Update available</button>
    return <aside className="memba-update" aria-label="App update" aria-live="polite">
        <div className="memba-update-head"><span className="memba-update-mark" aria-hidden="true">↻</span><div><h2>Update available</h2><span>Ready when you are</span></div></div>
        <p>A newer Memba is ready. Save any work here before reloading.</p>
        {walletPending && <p id="memba-update-wallet" role="status">Finish the wallet request before reloading.</p>}
        {activationFailed && <p role="status">The update did not start. Close Memba's tabs and open it again to load it.</p>}
        <div className="memba-update-actions">
            <button type="button" className="memba-update-later" onClick={() => setCollapsed(true)}>Later</button>
            <button type="button" disabled={walletPending || activating}
                aria-describedby={walletPending ? 'memba-update-wallet' : undefined}
                onClick={reload}>
                {activating ? 'Preparing update…' : 'Reload to update'}
            </button>
        </div>
    </aside>
}
