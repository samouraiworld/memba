import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FREE_PLAY_REALM, type FreePlayClient, type FreePlayInput } from '../../../../lib/arcadeFreePlay'
import { createFreePlaySnapshot, loadFreePlaySnapshot, persistFreePlaySnapshot } from '../../../arcade/freeplay/snapshot'
import { makeFpsRuntimeBridge } from './runtime'
import vectors from './fixtures/terminal-vectors.json'

const snapshot = createFreePlaySnapshot(vectors[0] as FreePlayInput)
function setup() {
    const rows = new Map<string, string>()
    const storage = {
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: vi.fn((key: string, value: string) => { rows.set(key, value) }),
    }
    persistFreePlaySnapshot(storage, snapshot)
    const connect = vi.fn()
    const config = { rules: snapshot.input.rules, simVersion: snapshot.input.simVersion, storage, connect }
    return { rows, storage, connect, config }
}

describe('FPS consumer with integrated A8 recovery', () => {
    it.each([false, true])('wires explicit Connect for the saved FPS result (shared client: %s)', async withClient => {
        const s = setup()
        const api = vi.fn(async () => { throw new Error('unexpected API') })
        const unsubscribe = vi.fn()
        const client: FreePlayClient = { bind: vi.fn(), subscribeIdentity: () => unsubscribe, board: api, verify: api, read: api, quote: api, publish: api }
        const bridge = makeFpsRuntimeBridge({ ...s.config, client: withClient ? client : undefined })!
        const handle = bridge.saved!.open(snapshot.input.clientRunId)
        const mounted = render(handle.render())
        expect(s.connect).not.toHaveBeenCalled()
        expect(api).not.toHaveBeenCalled()
        expect(screen.getByText(/After connecting/)).toBeInTheDocument()
        s.storage.setItem.mockClear()
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' })) })
        expect(s.connect).toHaveBeenCalledTimes(1)
        // Only one shared guard at the click; session emissions must not loop.
        expect(s.storage.setItem).toHaveBeenCalledTimes(2)
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)?.input).toEqual(snapshot.input)
        expect(api).not.toHaveBeenCalled()
        mounted.unmount(); handle.dispose()
        expect(unsubscribe).toHaveBeenCalledTimes(withClient ? 1 : 0)
    })

    it('blocks Connect and exports the retained FPS binding when the index fails at the click', () => {
        const s = setup()
        const retained = { ...snapshot, binding: { player: 'g1' + 'a'.repeat(38), target: { chainId: 'dev', realm: FREE_PLAY_REALM } } }
        persistFreePlaySnapshot(s.storage, retained)
        const handle = makeFpsRuntimeBridge(s.config)!.saved!.open(snapshot.input.clientRunId)
        const mounted = render(handle.render())
        s.rows.delete('memba:arcade:freeplay:index:v1')
        s.storage.setItem.mockImplementation((key, value) => { if (!key.endsWith('index:v1')) s.rows.set(key, value) })
        fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' }))
        expect(s.connect).not.toHaveBeenCalled()
        expect(screen.getByRole('textbox', { name: 'Completed result export' })).toHaveValue(JSON.stringify(retained, null, 2))
        expect(screen.queryByText(/After connecting/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Connect wallet for saved scores' })).not.toBeInTheDocument()
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)).toEqual(retained)
        mounted.unmount(); handle.dispose()
    })

    it('keeps an export when a client is configured but initial persistence fails', () => {
        const s = setup()
        const api = vi.fn(async () => { throw new Error('unexpected API') })
        const subscribeIdentity = vi.fn(() => () => {})
        const client: FreePlayClient = { bind: vi.fn(), subscribeIdentity, board: api, verify: api, read: api, quote: api, publish: api }
        s.storage.setItem.mockImplementation(() => { throw new Error('quota') })
        const handle = makeFpsRuntimeBridge({ ...s.config, client })!.saved!.open(snapshot.input.clientRunId)
        const mounted = render(handle.render())
        expect(screen.getByRole('textbox', { name: 'Completed result export' })).toHaveValue(JSON.stringify(snapshot, null, 2))
        expect(screen.queryByRole('button', { name: 'Connect wallet for saved scores' })).not.toBeInTheDocument()
        expect(s.connect).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled(); expect(subscribeIdentity).not.toHaveBeenCalled()
        mounted.unmount(); handle.dispose()
    })

    it('refuses Connect from a disposed local FPS handle', () => {
        const s = setup(), handle = makeFpsRuntimeBridge(s.config)!.saved!.open(snapshot.input.clientRunId)
        const mounted = render(handle.render())
        handle.dispose()
        fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' }))
        expect(s.connect).not.toHaveBeenCalled()
        expect(screen.getByRole('textbox', { name: 'Completed result export' })).toHaveValue(JSON.stringify(snapshot, null, 2))
        mounted.unmount()
    })
})
