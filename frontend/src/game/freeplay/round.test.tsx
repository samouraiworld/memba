import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import vectors from '../../games/arcade/freeplay/vectors.json'
import { useGame } from '../hooks/useGame'
import { initGame, step, type Move } from '../engine'
import { blockPartyFreePlaySnapshot, type CompletedPracticeRound } from './round'

const opts = { seed: 4242, modifier: 'standard' as const, mode: 'practice' as const, moveBudget: Infinity }
const fixture = vectors.runs[0]
afterEach(() => vi.restoreAllMocks())

describe('Block Party certification journal', () => {
    it('records accepted moves and Undo once under StrictMode, preserving RNG replay', () => {
        const { result } = renderHook(() => useGame(opts), { wrapper: StrictMode })
        const id = result.current.roundId
        const moves = fixture.input.replay.slice(0, 4)
        act(() => { for (const move of moves) result.current.play(move as Move) })
        const board = result.current.board.slice()
        const score = result.current.score
        expect(result.current.actionLog).toBe(moves)
        act(() => { result.current.undo(); result.current.play(moves.at(-1) as Move) })
        expect(result.current.actionLog).toBe(`${moves}Z${moves.at(-1)}`)
        expect(result.current.moveLog).toBe(moves)
        expect(result.current.board).toEqual(board)
        expect(result.current.score).toBe(score)
        expect(result.current.roundId).toBe(id)
    })

    it('forks terminal Undo and preserves the completed snapshot when the same last move is replayed', () => {
        const { result } = renderHook(() => useGame(opts))
        const replay = fixture.input.replay
        act(() => { for (const move of replay) result.current.play(move as Move) })
        expect(result.current.over).toBe(true)
        const original = blockPartyFreePlaySnapshot(result.current)
        expect(original?.input.claimedScore).toBe(fixture.score)
        expect(original?.input.replay).toBe(replay)
        act(() => { result.current.undo(); result.current.play(replay.at(-1) as Move) })
        const second = blockPartyFreePlaySnapshot(result.current)
        expect(second).not.toBeNull()
        expect(second?.input.clientRunId).not.toBe(original?.input.clientRunId)
        expect(second?.input.claimedScore).toBe(original?.input.claimedScore)
        expect(second?.input.replay).toBe(`${replay}Z${replay.at(-1)}`)
        expect(original?.input.replay).toBe(replay)
    })

    it('ignores empty Undo and no-op inputs; restarting the same seed creates a new identity', () => {
        const { result } = renderHook(() => useGame(opts))
        const id = result.current.roundId
        act(() => result.current.undo())
        expect(result.current.actionLog).toBe('')
        let engine = initGame(opts.seed, 'standard')
        let accepted = ''
        const attempted: Move[] = ['L', 'L', 'L', 'U', 'U', 'U']
        for (const move of attempted) { const next = step(engine, move); if (next !== engine) { accepted += move; engine = next } }
        act(() => { for (const move of attempted) result.current.play(move) })
        expect(result.current.actionLog).toBe(accepted)
        expect(result.current.board).toEqual(engine.board)
        act(() => result.current.restart(opts.seed))
        expect(result.current.roundId).not.toBe(id)
        expect(result.current.actionLog).toBe('')
    })

    it('keeps local play usable without random UUID entropy', () => {
        vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable') })
        const { result } = renderHook(() => useGame(opts))
        act(() => result.current.play(fixture.input.replay[0] as Move))
        expect(result.current.movesUsed).toBe(1)
        expect(result.current.roundId).toBeNull()
        expect(blockPartyFreePlaySnapshot(result.current)).toBeNull()
    })

    it('never labels ranked, nonstandard, unfinished or over-limit rounds as the reviewed standard rules', () => {
        const round: CompletedPracticeRound = {
            roundId: fixture.input.clientRunId, roundMode: 'practice', roundSeed: 4242,
            roundModifier: 'standard', actionLog: fixture.input.replay, score: fixture.score, roundOver: true,
        }
        expect(blockPartyFreePlaySnapshot(round)?.input).toEqual({ ...fixture.input, claimedScore: fixture.score })
        for (const patch of [{ roundMode: 'ranked' as const }, { roundModifier: 'rush' as const }, { roundOver: false }, { actionLog: 'U'.repeat(100001) }, { roundSeed: -1 }]) {
            expect(blockPartyFreePlaySnapshot({ ...round, ...patch })).toBeNull()
        }
    })
})
