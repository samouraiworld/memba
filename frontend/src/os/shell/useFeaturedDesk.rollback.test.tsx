import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_NETWORK } from '../../lib/config'
import { useDesk } from './useDesk'
vi.mock('../../lib/notes/config', async original => ({ ...await original<typeof import('../../lib/notes/config')>(), NOTES_ENABLED: false }))
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
it('keeps hidden pins and fixed labels in the v3 ledger while the Notes UI is rolled back', async () => {
    const noteId = 'ab'.repeat(16), key = 'memba_os_desk:v3:test-chain:guest'
    const raw = { version: 3, partition: { chainId: 'test-chain', wallet: null }, resetToken: null,
        items: [{ ty: 'note', ref: noteId, c: 0, r: 0 }],
        releases: { 'sushi-v1': { status: 'seeded', noteId }, 'whitepaper-v1': { status: 'pending' } } }
    localStorage.setItem(key, JSON.stringify(raw))
    vi.stubGlobal('navigator', { locks: { request: async (_key: string, _options: unknown, callback: () => unknown) => callback() } })
    const hook = renderHook(() => useDesk(null, DEFAULT_NETWORK, { chainId: 'test-chain', gno: true, adopt: false, releases: [] }))
    await waitFor(() => expect(hook.result.current.noteLabels[noteId]).toBe('Sushi recipe'))
    expect(hook.result.current.items).toEqual([])
    act(() => hook.result.current.pin({ ty: 'app', ref: 'wallet' }))
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))
    const saved = JSON.parse(localStorage.getItem(key)!)
    expect(saved.items[0]).toEqual(raw.items[0]); expect(saved.items[1]).toMatchObject({ ty: 'app', ref: 'wallet', c: 0, r: 1 })
    expect(saved.releases).toEqual(raw.releases)
})
