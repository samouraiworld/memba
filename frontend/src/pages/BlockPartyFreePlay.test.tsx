import { webcrypto } from 'node:crypto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreePlayClient } from '../lib/arcadeFreePlay'
import { FreePlayRuntimeProvider } from '../games/arcade/freeplay/FreePlayRuntimeProvider'
import type { FreePlayGameRuntime } from '../games/arcade/freeplay/FreePlayRuntimeContext'
import { createFreePlaySnapshot, listFreePlaySnapshots, saveFreePlaySnapshot } from '../games/arcade/freeplay/snapshot'
import vectors from '../games/arcade/freeplay/vectors.json'
import BlockPartyGame, { type BlockPartyGameProps } from './BlockPartyGame'

vi.mock('../lib/gameApi', () => ({ gameApi: {
    getDailyChallenge: vi.fn(async () => ({ date: new Date().toISOString().slice(0, 10), seed: 4242, modifier: 'standard', par: 1500n, moveBudget: 30, blockHeight: 42n, blockHash: 'abc', ready: true })),
    getDailyLeaderboard: vi.fn(async () => ({ entries: [] })), getStreak: vi.fn(async () => ({ streak: { current: 0, longest: 0, freezesRemaining: 1 } })),
} }))
vi.mock('../hooks/useAdena', () => ({ useAdena: () => ({ installed: false, connected: false, address: '' }) }))
const vector = vectors.runs[0]
const saved = createFreePlaySnapshot({ ...vector.input, game: 'block-party', claimedScore: vector.score })
const keys = { U: 'ArrowUp', R: 'ArrowRight', D: 'ArrowDown', L: 'ArrowLeft', Z: 'u' }
function setup() {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const reject = vi.fn(async () => { throw new Error('unexpected automatic API request') })
    const client: FreePlayClient = { bind: vi.fn(() => { throw new Error('unexpected bind') }), subscribeIdentity: () => () => {}, verify: reject, read: reject, quote: reject, publish: reject, board: reject }
    const runtime: FreePlayGameRuntime = { storage, client, target: vector.target, rules: saved.input.rules, simVersion: 1 }
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (props: BlockPartyGameProps = {}, provided = runtime) => <QueryClientProvider client={query}>
        <FreePlayRuntimeProvider value={{ games: { 'block-party': provided } }}><BlockPartyGame {...props} /></FreePlayRuntimeProvider>
    </QueryClientProvider>
    return { data, storage, runtime, client, reject, tree }
}
function cells() { return [...screen.getByRole('grid').querySelectorAll('[role="gridcell"]')].map(cell => cell.getAttribute('aria-label')) }
function move(key: string) { fireEvent.keyDown(screen.getByRole('grid'), { key }) }
beforeEach(() => {
    localStorage.clear(); localStorage.setItem('bp:intro:v1', '1')
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle, getRandomValues: (array: Uint32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>) => {
        if (array instanceof Uint32Array) { array.fill(4242); return array }
        return webcrypto.getRandomValues(array)
    } })
})
afterEach(() => vi.unstubAllGlobals())

describe('Block Party page Free play integration', () => {
    it('connects only on explicit click and coalesces repeated requests until completion', async () => {
        const s = setup()
        let reject!: (error: Error) => void
        s.runtime.connect = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
        saveFreePlaySnapshot(s.storage, saved)
        render(s.tree({ recovery: { clientRunId: saved.input.clientRunId, onClose: vi.fn() } }))
        expect(s.runtime.connect).not.toHaveBeenCalled()
        const connect = screen.getByRole('button', { name: 'Connect wallet for saved scores' })
        act(() => { fireEvent.click(connect); fireEvent.click(connect) })
        expect(s.runtime.connect).toHaveBeenCalledTimes(1)
        expect(connect).toBeDisabled()
        await act(async () => reject(new Error('cancelled')))
        expect(await screen.findByText(/Connection did not complete/)).toBeInTheDocument()
        expect(connect).toBeEnabled()
        expect(s.reject).not.toHaveBeenCalled()
        expect(listFreePlaySnapshots(s.storage).snapshots[0].input).toEqual(saved.input)
    })

    it('does not offer the terminal Connect path for an unfinished or unsaved result', async () => {
        const s = setup(); s.runtime.connect = vi.fn()
        const mounted = render(s.tree())
        expect(screen.queryByRole('button', { name: 'Connect wallet for saved scores' })).not.toBeInTheDocument()
        await screen.findByRole('grid')
        fireEvent.click(screen.getByRole('tab', { name: 'Practice' }))
        s.storage.setItem = () => { throw new Error('quota') }
        for (const action of saved.input.replay) move(keys[action as keyof typeof keys])
        await screen.findByRole('dialog', { name: 'Practice round complete' })
        expect(await screen.findByText(/Local storage is unavailable/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Connect wallet for saved scores' })).not.toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Block Party result export' })).toBeInTheDocument()
        expect(s.runtime.connect).not.toHaveBeenCalled(); expect(s.reject).not.toHaveBeenCalled()
        mounted.unmount()
    })

    it('saves only completed Practice with its full replay and keeps that result after restart', async () => {
        const s = setup(); render(s.tree())
        await screen.findByRole('grid')
        expect(listFreePlaySnapshots(s.storage).total).toBe(0)
        fireEvent.click(screen.getByRole('tab', { name: 'Practice' }))
        for (const action of saved.input.replay) move(keys[action as keyof typeof keys])
        await screen.findByRole('dialog', { name: 'Practice round complete' })
        await waitFor(() => expect(listFreePlaySnapshots(s.storage).total).toBe(1))
        const snapshot = listFreePlaySnapshots(s.storage).snapshots[0]
        expect(snapshot.input).toMatchObject({ replay: saved.input.replay, seed: saved.input.seed, claimedScore: saved.input.claimedScore, finishReason: 'game-over' })
        expect(s.reject).not.toHaveBeenCalled(); expect(s.client.bind).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'New practice board' }))
        expect(screen.queryByRole('dialog', { name: 'Practice round complete' })).not.toBeInTheDocument()
        expect(listFreePlaySnapshots(s.storage).snapshots[0]).toEqual(snapshot)
    })
    it('opens an archive beside the same paused engine and resumes the exact board when closed', async () => {
        const s = setup(); saveFreePlaySnapshot(s.storage, saved)
        const mounted = render(s.tree())
        await screen.findByRole('grid'); fireEvent.click(screen.getByRole('tab', { name: 'Practice' }))
        move('ArrowUp'); move('ArrowRight')
        const grid = screen.getByRole('grid'), before = cells(), onClose = vi.fn()
        mounted.rerender(s.tree({ recovery: { clientRunId: saved.input.clientRunId, onClose } }))
        expect(await screen.findByRole('heading', { name: 'Saved Block Party result' })).toHaveFocus()
        expect(screen.getByRole('grid')).toBe(grid)
        act(() => { move('ArrowDown'); move('u') })
        expect(cells()).toEqual(before)
        expect(s.reject).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Close saved result' }))
        expect(onClose).toHaveBeenCalledTimes(1)
        mounted.rerender(s.tree({ recovery: null }))
        expect(screen.getByRole('grid')).toBe(grid); expect(cells()).toEqual(before)
        expect(grid).toHaveFocus()
        move('ArrowDown'); move('ArrowLeft')
        expect(cells()).not.toEqual(before)
        expect(listFreePlaySnapshots(s.storage).total).toBe(1)
    })
    it('preserves explicit injection and rejects an unavailable ID without replacing the current game', async () => {
        const explicit = setup(), provider = setup()
        saveFreePlaySnapshot(explicit.storage, saved)
        const mounted = render(explicit.tree({ freePlay: explicit.runtime }, provider.runtime))
        await screen.findByRole('grid')
        fireEvent.click(screen.getByRole('button', { name: 'Show saved Block Party results' }))
        fireEvent.click(screen.getByRole('button', { name: /Review saved score/ }))
        expect(await screen.findByRole('button', { name: 'Verify score' })).toBeInTheDocument()
        expect(provider.data.size).toBe(0)
        fireEvent.click(screen.getByRole('button', { name: 'Close saved result' }))
        mounted.rerender(explicit.tree({ freePlay: explicit.runtime, recovery: { clientRunId: '11111111-1111-4111-8111-111111111111', onClose: vi.fn() } }, provider.runtime))
        expect(await screen.findByText(/This saved Block Party result is unavailable/)).toBeInTheDocument()
        expect(screen.getByRole('grid')).toBeInTheDocument()
        expect(explicit.reject).not.toHaveBeenCalled(); expect(provider.reject).not.toHaveBeenCalled()
        mounted.rerender(explicit.tree({ freePlay: null }, provider.runtime))
        expect(screen.queryByRole('button', { name: 'Show saved Block Party results' })).not.toBeInTheDocument()
    })
})
