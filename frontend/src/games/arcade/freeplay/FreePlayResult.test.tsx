import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { FreePlayClient, FreePlayInput, FreePlayRun } from '../../../lib/arcadeFreePlay'
import { FreePlayResult } from './FreePlayResult'
import { createFreePlaySession } from './session'
import { sanitizeSnapshot } from './snapshot'
import vectors from './vectors.json'

it('treats a persisted receipt as saved until fresh readback and never auto-publishes', async () => {
    const v = vectors.runs[0]
    const input = { ...v.input, claimedScore: v.score } as FreePlayInput
    const binding = { player: v.player, target: v.target }
    const entry = { game: input.game, player: v.player, rules: input.rules, simVersion: input.simVersion, seed: input.seed, score: v.score, runID: v.runID, stateHash: v.stateHash, replayHash: v.replayHash }
    const confirmed: FreePlayRun = { entry, target: v.target, clientRunId: input.clientRunId, replayCodec: input.replayCodec, replay: input.replay, payloadHash: v.payloadHash, status: 'confirmed', receipt: { target: v.target, entry, height: 42, attester: v.player, schemaVersion: 2 } }
    const publish = vi.fn()
    const client: FreePlayClient = { board: vi.fn(), subscribeIdentity: () => () => {}, bind: () => binding, read: async () => confirmed, verify: async () => confirmed, quote: vi.fn(), publish }
    const data = new Map<string, string>()
    const session = createFreePlaySession({ snapshot: sanitizeSnapshot({ schemaVersion: 1, input, binding, result: confirmed }), client, storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } } })
    const { unmount } = render(<FreePlayResult session={session} />)
    expect(screen.queryByText(/Score confirmed on/)).not.toBeInTheDocument()
    expect(screen.getByText(/Saved receipt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check saved result' }))
    expect(await screen.findByText(/Score confirmed on gnoland-1/)).toBeInTheDocument()
    expect(publish).not.toHaveBeenCalled()
    unmount(); session.dispose()
})
