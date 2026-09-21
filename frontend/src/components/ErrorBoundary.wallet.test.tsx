import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { TxConfirmationProvider } from './ui/TxConfirmation'
import { doContractBroadcast, setTxConfirmationCallback, setWalletRpcContext } from '../lib/grc20'
import { GNO_CHAIN_ID } from '../lib/config'
import { isWalletRequestPending } from '../lib/walletActivity'
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
function Content({ fail }: { fail: boolean }) {
    if (fail) throw new Error('Failed to fetch dynamically imported module')
    return <div>Loaded</div>
}
const tree = (fail: boolean) => <ErrorBoundary><TxConfirmationProvider><Content fail={fail} /></TxConfirmationProvider></ErrorBoundary>
const location = window.location
const reload = vi.fn()
beforeEach(() => {
    sessionStorage.clear()
    reload.mockClear()
    Object.defineProperty(window, 'location', { value: { ...location, reload }, writable: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setWalletRpcContext('https://selected.invalid', true, GNO_CHAIN_ID)
})
afterEach(() => {
    Object.defineProperty(window, 'location', { value: location, writable: true })
    setTxConfirmationCallback(null)
    setWalletRpcContext(null, false)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})
it('cancels an unmounted confirmation instead of leaving recovery permanently disabled', async () => {
    const DoContract = vi.fn()
    vi.stubGlobal('adena', { DoContract })
    const view = render(tree(false))
    let result!: Promise<unknown>
    await act(async () => { result = doContractBroadcast([], 'test', { retry: false }).catch(e => e) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    view.rerender(tree(true))
    await act(async () => { expect(await result).toMatchObject({ message: 'Transaction cancelled by user' }) })
    expect(isWalletRequestPending()).toBe(false)
    expect(DoContract).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeEnabled()
})
it('does not reload or repeat a deferred Adena request when the root fails', async () => {
    let resolve!: (value: unknown) => void
    const DoContract = vi.fn(() => new Promise(r => { resolve = r }))
    vi.stubGlobal('adena', { DoContract })
    const view = render(tree(false))
    let result!: ReturnType<typeof doContractBroadcast>
    await act(async () => { result = doContractBroadcast([], 'test', { retry: false }) })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Broadcast' }))
    await waitFor(() => expect(DoContract).toHaveBeenCalledTimes(1))
    view.rerender(tree(true))
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeDisabled()
    await act(async () => { resolve({ status: 'success', data: { hash: 'FIXTURE_RECEIPT' } }); await result })
    expect(await result).toMatchObject({ hash: 'FIXTURE_RECEIPT' })
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeEnabled()
    expect(reload).not.toHaveBeenCalled()
    expect(DoContract).toHaveBeenCalledTimes(1)
})
