import { webcrypto } from 'node:crypto'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Token } from '../../gen/memba/v1/memba_pb'
import { createFreePlayClient, type FreePlayRun } from '../../lib/arcadeFreePlay'
import { createFreePlaySnapshot, loadFreePlaySnapshot, sanitizeSnapshot, saveFreePlaySnapshot } from '../../games/arcade/freeplay/snapshot'
import vectors from '../../games/arcade/freeplay/vectors.json'
import { createOsFreePlayAuth, type FreePlayOsSession } from '../../games/arcade/freeplay/osAuth'
import { setWalletActionGuard, setWalletRpcContext } from '../../lib/grc20'
import { BlockPartyPublication, BlockPartySavedRuns } from './BlockPartyPublication'
const v = vectors.runs[0]
const input = { ...v.input, game: 'block-party' as const, claimedScore: v.score }
const snapshot = createFreePlaySnapshot(input)
const entry = { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, seed: input.seed, score: v.score, runID: v.runID, stateHash: v.stateHash, replayHash: v.replayHash }
const verified: FreePlayRun = { entry, target: v.target, clientRunId: input.clientRunId, replayCodec: input.replayCodec, replay: input.replay, payloadHash: v.payloadHash, status: 'verified' }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); setWalletActionGuard(null); setWalletRpcContext('https://rpc.gno.land:443', true, v.target.chainId, v.player) })
afterEach(() => { setWalletRpcContext(null, false); vi.unstubAllGlobals() })
function setup() {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    let state: FreePlayOsSession = {
        status: 'member', address: v.player, chainId: v.target.chainId, walletAddress: v.player, walletChainId: v.target.chainId,
        token: { nonce: 'nonce', userAddress: v.player, chainId: v.target.chainId, expiration: '2099-01-01T00:00:00Z', serverSignature: 'signed-token' } as Token,
    }
    const auth = createOsFreePlayAuth({ readSession: () => state })
    let status: FreePlayRun['status'] = 'verified'
    let loseFirstResponse = false
    const publications: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const path = new URL(String(url)).pathname
        if (path.endsWith('/quote')) return Response.json({ quoteId: 'a'.repeat(64), nonce: 'b'.repeat(64), runID: v.runID, payloadHash: v.payloadHash, payer: 'studio', expiresAt: Math.floor(Date.now() / 1000) + 60, maxFeeUgnot: 100, maxDepositUgnot: 200 })
        if (path.endsWith('/publish')) {
            publications.push(String(init?.body)); status = 'queued'
            if (loseFirstResponse && publications.length === 1) throw new Error('response lost')
        }
        return Response.json({ ...verified, status })
    })
    const client = createFreePlayClient({ origin: 'https://backend.example', target: v.target, auth, fetch: fetcher })
    return { storage, data, auth, client, fetcher, publications,
        loseResponse: () => { loseFirstResponse = true },
        change: (patch: Partial<FreePlayOsSession> & { walletVerified: boolean }) => {
            const { walletVerified, ...session } = patch
            state = { ...state, ...session }
            setWalletRpcContext('https://rpc.gno.land:443', walletVerified, state.walletChainId, state.walletAddress)
            auth.refreshIdentity()
        },
    }
}
async function review() {
    fireEvent.click(await screen.findByRole('button', { name: 'Verify score' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review publication' }))
    return screen.findByRole('button', { name: 'Confirm score publication' })
}

describe('mounted Block Party publication consumer', () => {
    it('requires Verify, quote review and explicit consent; double clicking sends once', async () => {
        const s = setup()
        const mounted = render(<BlockPartyPublication snapshot={snapshot} storage={s.storage} client={s.client} />)
        expect(s.fetcher).not.toHaveBeenCalled()
        const consent = await review()
        expect(s.publications).toHaveLength(0)
        expect(screen.getByText(/Your charge is 0 GNOT/)).toBeInTheDocument()
        act(() => { fireEvent.click(consent); fireEvent.click(consent) })
        await screen.findByText(/Waiting for onchain confirmation/)
        expect(s.publications).toHaveLength(1)
        expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.publication).toEqual(JSON.parse(s.publications[0]))
        expect(JSON.stringify([...s.data.values()])).not.toContain('signed-token')
        expect(s.fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: expect.stringContaining('server_signature') })
        mounted.unmount(); s.auth.dispose()
    })

    it('recovers from the common index after reload and retries the exact consent without a new quote', async () => {
        const s = setup(); s.loseResponse()
        const mounted = render(<BlockPartyPublication snapshot={snapshot} storage={s.storage} client={s.client} />)
        fireEvent.click(await review())
        await screen.findByRole('button', { name: 'Retry the same request' })
        mounted.unmount()
        const requests = s.fetcher.mock.calls.length
        const recovery = render(<BlockPartySavedRuns storage={s.storage} client={s.client} />)
        fireEvent.click(screen.getByRole('button', { name: 'Show saved Block Party results' }))
        fireEvent.click(screen.getByRole('button', { name: /Review saved score/ }))
        await screen.findByRole('button', { name: 'Check saved result' })
        expect(s.fetcher).toHaveBeenCalledTimes(requests)
        // A resumed saved request is exposed by the common session's explicit
        // read/check flow; no automatic read or quote is made by recovery.
        fireEvent.click(screen.getByRole('button', { name: 'Check saved result' }))
        await screen.findByText(/Waiting for onchain confirmation/)
        expect(s.publications).toHaveLength(1)
        expect(s.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/quote'))).toHaveLength(1)
        recovery.unmount()
        // The exact retry affordance is available after a failed explicit read.
        s.fetcher.mockRejectedValueOnce(new Error('offline'))
        const again = render(<BlockPartyPublication snapshot={snapshot} storage={s.storage} client={s.client} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Check saved result' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Retry the same request' }))
        await screen.findByText(/Waiting for onchain confirmation/)
        expect(s.publications).toHaveLength(2)
        expect(s.publications[1]).toBe(s.publications[0])
        expect(s.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/quote'))).toHaveLength(1)
        again.unmount(); s.auth.dispose()
    })

    it('keeps an export and performs no request when storage is unavailable', async () => {
        const s = setup()
        s.storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
        const mounted = render(<BlockPartyPublication snapshot={snapshot} storage={s.storage} client={s.client} />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Local storage is unavailable')
        expect(screen.getByRole('textbox', { name: 'Block Party result export', hidden: true })).toHaveValue(JSON.stringify(snapshot, null, 2))
        expect(s.fetcher).not.toHaveBeenCalled()
        mounted.unmount(); s.auth.dispose()
    })

    it('drops a late response after wallet/network A→B→A without a React identity render', async () => {
        const s = setup()
        let resolve!: (response: Response) => void
        s.fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
        const mounted = render(<BlockPartyPublication snapshot={snapshot} storage={s.storage} client={s.client} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Verify score' }))
        await waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(1))
        act(() => { s.change({ walletChainId: 'onyx-1', walletVerified: false }); s.change({ walletChainId: v.target.chainId, walletVerified: true }) })
        await act(async () => resolve(Response.json(verified)))
        expect(screen.queryByRole('button', { name: 'Review publication' })).not.toBeInTheDocument()
        expect(loadFreePlaySnapshot(s.storage, input.clientRunId)?.result).toBeUndefined()
        expect(s.publications).toHaveLength(0)
        mounted.unmount(); s.auth.dispose()
    })

    it('shows a recovered receipt as saved until explicit readback', async () => {
        const s = setup()
        const confirmed: FreePlayRun = { ...verified, status: 'confirmed', receipt: { target: v.target, entry, height: 42, attester: v.player, schemaVersion: 2 } }
        saveFreePlaySnapshot(s.storage, sanitizeSnapshot({ schemaVersion: 1, input, binding: { player: v.player, target: v.target }, result: confirmed }))
        s.fetcher.mockResolvedValue(Response.json(confirmed))
        const mounted = render(<BlockPartySavedRuns storage={s.storage} client={s.client} />)
        fireEvent.click(screen.getByRole('button', { name: 'Show saved Block Party results' }))
        fireEvent.click(screen.getByRole('button', { name: /Review saved score/ }))
        expect(await screen.findByText(/Saved receipt/)).toBeInTheDocument()
        expect(screen.queryByText(/Score confirmed on/)).not.toBeInTheDocument()
        expect(s.fetcher).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Check saved result' }))
        expect(await screen.findByText(/Score confirmed on gnoland-1/)).toBeInTheDocument()
        mounted.unmount(); s.auth.dispose()
    })
})
