import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { isWalletRequestPending, subscribeWalletActivity } from '../lib/walletActivity'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
const ACTIVATION_TIMEOUT_MS = 15_000

/** A new worker may install while an old tab has unsaved work. Only a click reloads it. */
export function UpdateNotice() {
    const [ready, setReady] = useState(false)
    const [activating, setActivating] = useState(false)
    const [activationFailed, setActivationFailed] = useState(false)
    const walletPending = useSyncExternalStore(subscribeWalletActivity, isWalletRequestPending)
    const updateWorker = useRef<ReturnType<typeof registerSW> | null>(null)
    const newWorkerControlsPage = useRef(false)
    const reloadRequested = useRef(false)
    const activationTimer = useRef<number | undefined>(undefined)

    useEffect(() => {
        let mounted = true
        let registration: ServiceWorkerRegistration | undefined
        const checkForUpdate = () => {
            if (!registration || registration.installing || !navigator.onLine || document.visibilityState !== 'visible') return
            void registration.update().catch(() => { /* Retry on the next focus or interval. */ })
        }

        updateWorker.current = registerSW({
            immediate: true,
            onNeedRefresh() {
                if (mounted) setReady(true)
            },
            onNeedReload() {
                newWorkerControlsPage.current = true
                window.clearTimeout(activationTimer.current)
                if (!mounted) return
                setReady(true)
                setActivating(false)
                if (reloadRequested.current && !isWalletRequestPending()) window.location.reload()
                else reloadRequested.current = false
            },
            onRegisteredSW(_url, workerRegistration) {
                registration = workerRegistration
            },
        })

        window.addEventListener('focus', checkForUpdate)
        window.addEventListener('online', checkForUpdate)
        document.addEventListener('visibilitychange', checkForUpdate)
        const interval = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)
        return () => {
            mounted = false
            updateWorker.current = null
            window.clearInterval(interval)
            window.clearTimeout(activationTimer.current)
            window.removeEventListener('focus', checkForUpdate)
            window.removeEventListener('online', checkForUpdate)
            document.removeEventListener('visibilitychange', checkForUpdate)
        }
    }, [])

    const reload = async () => {
        if (isWalletRequestPending() || activating) return
        reloadRequested.current = true
        setActivationFailed(false)
        if (newWorkerControlsPage.current) {
            window.location.reload()
            return
        }
        setActivating(true)
        try {
            await updateWorker.current?.()
            activationTimer.current = window.setTimeout(() => {
                if (newWorkerControlsPage.current) return
                reloadRequested.current = false
                setActivating(false)
                setActivationFailed(true)
            }, ACTIVATION_TIMEOUT_MS)
        } catch {
            reloadRequested.current = false
            setActivating(false)
            setActivationFailed(true)
        }
    }

    if (!ready) return null
    return <aside className="memba-update" aria-label="App update" aria-live="polite">
        <h2>Update available</h2>
        <p>Save your work, then reload for the latest Memba.</p>
        {walletPending && <p id="memba-update-wallet" role="status">Finish the wallet request before reloading.</p>}
        {activationFailed && <p role="status">The update could not start. Try again when you are online.</p>}
        <button type="button" disabled={walletPending || activating}
            aria-describedby={walletPending ? 'memba-update-wallet' : undefined}
            onClick={() => { void reload() }}>
            {activating ? 'Preparing update…' : 'Reload to update'}
        </button>
    </aside>
}
