import { createFreePlaySnapshot, type FreePlaySnapshot } from '../../games/arcade/freeplay/snapshot'
import type { Modifier } from '../engine'

/** Independent of the game RNG. Unavailable entropy never prevents local play. */
export function newPracticeRunId(): string | null {
    try {
        const bytes = new Uint8Array(16)
        globalThis.crypto.getRandomValues(bytes)
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    } catch { return null }
}

export interface CompletedPracticeRound {
    roundId: string | null
    roundMode: 'ranked' | 'practice'
    roundSeed: number
    roundModifier: Modifier
    actionLog: string
    score: number
    roundOver: boolean
}

/** Only the reviewed terminal standard rules can become a certification input. */
export function blockPartyFreePlaySnapshot(round: CompletedPracticeRound): FreePlaySnapshot | null {
    if (!round.roundOver || round.roundMode !== 'practice' || round.roundModifier !== 'standard'
        || !round.roundId || !/^[URDLZ]{1,100000}$/.test(round.actionLog)
        || !Number.isInteger(round.roundSeed) || round.roundSeed < 0 || round.roundSeed > 0xffffffff
        || !Number.isSafeInteger(round.score) || round.score < 0) return null
    try {
        return createFreePlaySnapshot({
            clientRunId: round.roundId, game: 'block-party', rules: 'bp-free-standard-undo-v1', simVersion: 1,
            seed: `bp1:${round.roundSeed.toString(16).padStart(8, '0')}`, replayCodec: 'bp-actions-v1',
            replay: round.actionLog, finishReason: 'game-over', claimedScore: round.score,
        })
    } catch { return null }
}
