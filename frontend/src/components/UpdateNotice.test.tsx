import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { withWalletActivity } from '../lib/walletActivity'
import { setTxConfirmationCallback } from '../lib/grc20'
import { SignerProvider } from '../os/sign/SignerProvider'
import type { SignRequest } from '../os/sign/signer'
import { useSigner } from '../os/sign/signerContext'
import type { OsSession } from '../os/shell/useOsSession'
import { UpdateNotice } from './UpdateNotice'

const pwa = vi.hoisted(() => ({ options: null as RegisterSWOptions | null }))
vi.mock('virtual:pwa-register', () => ({
    registerSW: (options: RegisterSWOptions) => { pwa.options = options; return async () => {} },
}))

const originalLocation = window.location
const reload = vi.fn()
beforeEach(() => {
    pwa.options = null
    reload.mockClear()
    Object.defineProperty(window, 'location', { value: { ...originalLocation, reload }, writable: true })
})
afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
    vi.useRealTimers()
})

/** A new worker installed and waiting, as the browser hands it to the page. */
class WaitingWorker extends EventTarget {
    state: ServiceWorkerState = 'installed'
    postMessage = vi.fn()
    become(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')) }
    activate() { this.become('activated') }
}
function registered(waiting: WaitingWorker | null) {
    act(() => { pwa.options?.onRegisteredSW?.('/sw.js', { update: vi.fn(async () => {}), installing: null, waiting } as unknown as ServiceWorkerRegistration) })
}
const skipWaiting = { type: 'SKIP_WAITING' }

it('notifies without navigating and reloads only after the user clicks', async () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    act(() => { pwa.options?.onNeedRefresh?.() })
    expect(screen.getByText('Update available')).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(worker.postMessage).toHaveBeenCalledWith(skipWaiting)
    expect(reload).not.toHaveBeenCalled()
    // A controlled page: the new worker takes control.
    act(() => { pwa.options?.onNeedReload?.() })
    expect(reload).toHaveBeenCalledTimes(1)
    // Its "activated" state may follow: still one reload.
    act(() => { worker.activate() })
    expect(reload).toHaveBeenCalledTimes(1)
})

it('reloads once the waiting worker is activated, even on a page no worker controls (opened by a hard reload)', () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(worker.postMessage).toHaveBeenCalledWith(skipWaiting)
    expect(screen.getByRole('button', { name: 'Preparing update…' })).toBeDisabled()
    // No controller change ever reaches this page; the worker's own state does.
    act(() => { worker.activate() })
    expect(reload).toHaveBeenCalledTimes(1)
    // On a controlled page the controller change may come after: still one reload.
    act(() => { pwa.options?.onNeedReload?.() })
    expect(reload).toHaveBeenCalledTimes(1)
})

it('waits through "activating" and reloads once on "activated"', () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    act(() => { worker.become('activating') })
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Preparing update…' })).toBeDisabled()
    act(() => { worker.become('activated') })
    expect(reload).toHaveBeenCalledTimes(1)
})

it('does not reload when the waiting worker turns redundant', () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    act(() => { worker.become('redundant') })
    expect(reload).not.toHaveBeenCalled()
})

it('stops listening to the worker when the card unmounts', () => {
    const { unmount } = render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    unmount()
    worker.activate()
    expect(reload).not.toHaveBeenCalled()
})

it('reloads at once when nothing is waiting: the newest worker is already active', () => {
    render(<UpdateNotice />)
    registered(null)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(reload).toHaveBeenCalledTimes(1)
})

it('says plainly what to do when the worker is still waiting after the timeout, and does not reload', async () => {
    vi.useFakeTimers()
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(screen.getByText("The update did not start. Close Memba's tabs and open it again to load it.")).toBeVisible()
    expect(screen.queryByText(/when you are online/)).not.toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload to update' })).toBeEnabled()
})

it('does not reload when a wallet request begins while the worker activates', async () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    let finish!: () => void
    let wallet!: Promise<void>
    await act(async () => { wallet = withWalletActivity(() => new Promise<void>(resolve => { finish = resolve })) })
    act(() => { worker.activate() })
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { finish(); await wallet })
})

it('does not report a failed update after the worker took over while a wallet request held the reload', async () => {
    vi.useFakeTimers()
    render(<UpdateNotice />)
    registered(new WaitingWorker())
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    let finish!: () => void
    let wallet!: Promise<void>
    await act(async () => { wallet = withWalletActivity(() => new Promise<void>(resolve => { finish = resolve })) })
    act(() => { pwa.options?.onNeedReload?.() })
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(screen.queryByText(/The update did not start/)).not.toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { finish(); await wallet })
})

it('can be deferred to a compact update action and reopened', () => {
    render(<UpdateNotice />)
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('complementary', { name: 'App update' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Update available/ }))
    expect(screen.getByRole('button', { name: 'Reload to update' })).toBeEnabled()
    expect(reload).not.toHaveBeenCalled()
})

it('keeps the reload action disabled for a pending wallet decision', async () => {
    render(<UpdateNotice />)
    const worker = new WaitingWorker()
    registered(worker)
    act(() => { pwa.options?.onNeedRefresh?.() })
    let finish!: () => void
    let wallet!: Promise<void>
    await act(async () => { wallet = withWalletActivity(() => new Promise<void>(resolve => { finish = resolve })) })
    const button = screen.getByRole('button', { name: 'Reload to update' })
    expect(button).toBeDisabled()
    expect(screen.getByText('Finish the wallet request before reloading.')).toBeVisible()
    fireEvent.click(button)
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { finish(); await wallet })
    expect(button).toBeEnabled()
})

it('keeps reload disabled while an OS signature review sheet is open', () => {
    const request: SignRequest = {
        title: 'Vote', summary: 'Review a vote', lines: () => [], label: () => 'Vote',
        prepare: () => ({ msgs: [] }), send: async () => ({ hash: 'unused' }),
    }
    function OpenReview() {
        const signer = useSigner()
        return <button type="button" onClick={() => signer.sign(request)}>Open review</button>
    }
    const session = { status: 'member', network: { chainId: 'gnoland-1' }, openConnect: vi.fn() } as unknown as OsSession
    render(<><UpdateNotice /><SignerProvider session={session} toast={vi.fn()}><OpenReview /></SignerProvider></>)
    act(() => { pwa.options?.onNeedRefresh?.() })
    const button = screen.getByRole('button', { name: 'Reload to update' })
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }))
    expect(screen.getByRole('dialog', { name: 'Review · Vote' })).toBeVisible()
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(button).toBeEnabled()
})

it('keeps reload disabled while a sent OS transaction is in the verification tray', async () => {
    let resolveVerify!: (confirmed: boolean) => void
    const request: SignRequest = {
        title: 'Vote', summary: 'Review a vote', lines: () => [], label: () => 'Vote',
        prepare: () => ({ msgs: [] }),
        send: async (_choice, beforeSign) => {
            const confirm = setTxConfirmationCallback(null)
            setTxConfirmationCallback(confirm)
            if (!confirm || !(await confirm([], ''))) throw new Error('Review did not approve this request')
            const guard = await beforeSign()
            if (guard && !guard()) throw new Error('Session changed')
            return { hash: 'sent-hash' }
        },
        verify: () => new Promise<boolean>(resolve => { resolveVerify = resolve }),
        verifyAttempts: 1,
    }
    function OpenReview() {
        const signer = useSigner()
        return <><button type="button" onClick={() => signer.sign(request)}>Open review</button>
            <output data-testid="pending-count">{signer.pending.length}</output></>
    }
    const session = { status: 'member', network: { chainId: 'gnoland-1' }, openConnect: vi.fn() } as unknown as OsSession
    render(<><UpdateNotice /><SignerProvider session={session} toast={vi.fn()}><OpenReview /></SignerProvider></>)
    act(() => { pwa.options?.onNeedRefresh?.() })
    const button = screen.getByRole('button', { name: 'Reload to update' })
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Adena' }))
    await waitFor(() => expect(screen.getByTestId('pending-count')).toHaveTextContent('1'))
    expect(screen.queryByRole('dialog', { name: 'Review · Vote' })).not.toBeInTheDocument()
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { resolveVerify(true) })
    await waitFor(() => expect(button).toBeEnabled())
})

it('does not auto-reload if another tab activates the new worker', () => {
    render(<UpdateNotice />)
    act(() => { pwa.options?.onNeedReload?.() })
    expect(screen.getByText('Update available')).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(reload).toHaveBeenCalledTimes(1)
})

it('does not reload when a wallet request begins after the update click', async () => {
    render(<UpdateNotice />)
    registered(new WaitingWorker())
    act(() => { pwa.options?.onNeedRefresh?.() })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    let finish!: () => void
    let wallet!: Promise<void>
    await act(async () => { wallet = withWalletActivity(() => new Promise<void>(resolve => { finish = resolve })) })
    act(() => { pwa.options?.onNeedReload?.() })
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { finish(); await wallet })
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(reload).toHaveBeenCalledTimes(1)
})

it('checks for an update when an older tab regains focus', () => {
    render(<UpdateNotice />)
    const update = vi.fn(async () => {})
    act(() => { pwa.options?.onRegisteredSW?.('/sw.js', { update, installing: null } as unknown as ServiceWorkerRegistration) })
    fireEvent.focus(window)
    expect(update).toHaveBeenCalledTimes(1)
})
