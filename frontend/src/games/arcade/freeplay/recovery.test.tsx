import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreePlayClient, FreePlayInput } from '../../../lib/arcadeFreePlay'
import { FreePlayConnect } from './FreePlayConnect'
import { FreePlayResult } from './FreePlayResult'
import { createFreePlaySession } from './session'
import { createFreePlaySnapshot, loadFreePlaySnapshot, persistFreePlaySnapshot, prepareFreePlayRecovery, sanitizeSnapshot } from './snapshot'
import vectors from './vectors.json'
const v = vectors.runs[0]
const snapshot = createFreePlaySnapshot({ ...v.input, claimedScore: v.score } as FreePlayInput)
function setup() {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    return { storage, data }
}
describe('completed result recovery guard', () => {
    it('requires both canonical readback and shared index membership', () => {
        for (const failed of ['canonical', 'index']) {
            const s = setup(), save = s.storage.setItem
            s.storage.setItem = (key, value) => { if ((failed === 'index') === key.endsWith('index:v1')) return; save(key, value) }
            expect(() => persistFreePlaySnapshot(s.storage, snapshot)).toThrow('storage_unavailable')
        }
        const s = setup()
        expect(prepareFreePlayRecovery(s.storage, snapshot)).toEqual(snapshot)
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)).toEqual(snapshot)
    })
    it('preserves canonical binding and consent when a guest wrapper reconnects', () => {
        const s = setup()
        const bound = sanitizeSnapshot({ ...snapshot, binding: { player: v.player, target: v.target }, result: { entry: { game: snapshot.input.game, player: v.player, rules: snapshot.input.rules, simVersion: snapshot.input.simVersion, runID: v.runID, seed: snapshot.input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash }, payloadHash: v.payloadHash, status: 'queued' }, publication: { payloadHash: v.payloadHash, quoteId: 'a'.repeat(64), nonce: 'b'.repeat(64) } })
        persistFreePlaySnapshot(s.storage, bound)
        expect(prepareFreePlayRecovery(s.storage, snapshot)).toEqual(bound)
        expect(() => prepareFreePlayRecovery(s.storage, { ...snapshot, binding: { player: 'g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq', target: v.target } })).toThrow('run_conflict')
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)).toEqual(bound)
    })
    it('does not overwrite a different replay under the same UUID', () => {
        const s = setup(); persistFreePlaySnapshot(s.storage, snapshot)
        expect(() => prepareFreePlayRecovery(s.storage, { ...snapshot, input: { ...snapshot.input, replay: snapshot.input.replay + 'Z' } })).toThrow('run_conflict')
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)).toEqual(snapshot)
    })
    it('rechecks storage at the click and does not connect when index persistence fails', () => {
        const s = setup(), connect = vi.fn()
        const prepare = () => prepareFreePlayRecovery(s.storage, snapshot)
        render(<FreePlayConnect snapshot={snapshot} prepare={prepare} connect={connect} />)
        expect(connect).not.toHaveBeenCalled()
        expect(screen.getByText(/After connecting/)).toBeInTheDocument()
        s.storage.setItem = () => { throw new Error('quota') }
        fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' }))
        expect(connect).not.toHaveBeenCalled()
        expect(screen.getByRole('alert')).toHaveTextContent('could not be saved')
        expect(screen.getByRole('textbox', { name: 'Completed result export' })).toHaveValue(JSON.stringify(snapshot, null, 2))
    })
    it('connects only explicitly after exact recovery and coalesces clicks across unmount', async () => {
        const s = setup(); let finish!: () => void
        const connect = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
        const prepare = () => prepareFreePlayRecovery(s.storage, snapshot)
        const { unmount } = render(<FreePlayConnect snapshot={snapshot} prepare={prepare} connect={connect} />)
        expect(connect).not.toHaveBeenCalled()
        const button = screen.getByRole('button', { name: 'Connect wallet for saved scores' })
        fireEvent.click(button); fireEvent.click(button)
        expect(connect).toHaveBeenCalledTimes(1)
        expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)?.input).toEqual(snapshot.input)
        unmount(); await act(async () => { finish() })
        expect(prepareFreePlayRecovery(s.storage, snapshot).input.clientRunId).toBe(snapshot.input.clientRunId)
    })
})


it('exports only B when its guard fails after reuse and ignores late Connect A', async () => {
    const s = setup(); let finish!: () => void
    const connectA = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const prepareA = () => prepareFreePlayRecovery(s.storage, snapshot)
    const mounted = render(<FreePlayConnect snapshot={snapshot} prepare={prepareA} connect={connectA} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' }))
    const b = createFreePlaySnapshot({ ...snapshot.input, clientRunId: '11111111-1111-4111-8111-111111111111', claimedScore: snapshot.input.claimedScore + 1 })
    const prepareB = () => { throw new Error('quota') }, connectB = vi.fn()
    mounted.rerender(<FreePlayConnect snapshot={b} prepare={prepareB} connect={connectB} />)
    const exported = screen.getByRole('textbox', { name: 'Completed result export' })
    expect(exported).toHaveValue(JSON.stringify(b, null, 2))
    expect(screen.queryByText(/After connecting/)).not.toBeInTheDocument()
    await act(async () => { finish() })
    expect(exported).toHaveValue(JSON.stringify(b, null, 2))
    expect(screen.queryByRole('button', { name: 'Connect wallet for saved scores' })).not.toBeInTheDocument()
    expect(connectB).not.toHaveBeenCalled()
})

it('does not roll back canonical consent replaced by another tab', () => {
    const s = setup()
    const bound = sanitizeSnapshot({ ...snapshot, binding: { player: v.player, target: v.target }, result: { entry: { game: snapshot.input.game, player: v.player, rules: snapshot.input.rules, simVersion: snapshot.input.simVersion, runID: v.runID, seed: snapshot.input.seed, score: v.score, stateHash: v.stateHash, replayHash: v.replayHash }, payloadHash: v.payloadHash, status: 'queued' }, publication: { payloadHash: v.payloadHash, quoteId: 'a'.repeat(64), nonce: 'b'.repeat(64) } })
    persistFreePlaySnapshot(s.storage, bound)
    const newer = { ...bound, publication: { payloadHash: v.payloadHash, quoteId: 'c'.repeat(64), nonce: 'd'.repeat(64) } }
    persistFreePlaySnapshot(s.storage, newer)
    expect(() => prepareFreePlayRecovery(s.storage, bound)).toThrow('run_conflict')
    expect(loadFreePlaySnapshot(s.storage, snapshot.input.clientRunId)?.publication).toEqual(newer.publication)
    expect(prepareFreePlayRecovery(s.storage, snapshot).publication).toEqual(newer.publication)
})


it('stabilizes the real session result/connect mount without persistence effect loops', async () => {
    const s = setup(), connect = vi.fn()
    const api = vi.fn(async () => { throw new Error('automatic API') })
    const client: FreePlayClient = { bind: vi.fn(), subscribeIdentity: () => () => {}, board: api, verify: api, read: api, quote: api, publish: api }
    const session = createFreePlaySession({ snapshot, storage: s.storage, client })
    const prepare = vi.spyOn(session, 'prepareRecovery')
    const mounted = render(<FreePlayResult session={session} connect={connect} />)
    await act(async () => { await Promise.resolve() })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet for saved scores' }))
    await act(async () => { await Promise.resolve() })
    expect(prepare).toHaveBeenCalledTimes(2); expect(connect).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
    mounted.unmount(); session.dispose()
})
