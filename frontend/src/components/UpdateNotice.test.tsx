import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { withWalletActivity } from '../lib/walletActivity'
import { UpdateNotice } from './UpdateNotice'

const pwa = vi.hoisted(() => ({
    options: null as RegisterSWOptions | null,
    update: vi.fn(async () => {}),
}))
vi.mock('virtual:pwa-register', () => ({
    registerSW: (options: RegisterSWOptions) => { pwa.options = options; return pwa.update },
}))

const originalLocation = window.location
const reload = vi.fn()
beforeEach(() => {
    pwa.options = null
    pwa.update.mockClear()
    reload.mockClear()
    Object.defineProperty(window, 'location', { value: { ...originalLocation, reload }, writable: true })
})
afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
})

it('notifies without navigating and reloads only after the user clicks', async () => {
    render(<UpdateNotice />)
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    act(() => { pwa.options?.onNeedRefresh?.() })
    expect(screen.getByText('Update available')).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(pwa.update).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    act(() => { pwa.options?.onNeedReload?.() })
    expect(reload).toHaveBeenCalledTimes(1)
})

it('keeps the reload action disabled for a pending wallet decision', async () => {
    render(<UpdateNotice />)
    act(() => { pwa.options?.onNeedRefresh?.() })
    let finish!: () => void
    let wallet!: Promise<void>
    await act(async () => { wallet = withWalletActivity(() => new Promise<void>(resolve => { finish = resolve })) })
    const button = screen.getByRole('button', { name: 'Reload to update' })
    expect(button).toBeDisabled()
    expect(screen.getByText('Finish the wallet request before reloading.')).toBeVisible()
    fireEvent.click(button)
    expect(pwa.update).not.toHaveBeenCalled()
    await act(async () => { finish(); await wallet })
    expect(button).toBeEnabled()
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
