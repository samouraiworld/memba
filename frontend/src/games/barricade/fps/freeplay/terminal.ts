import { FPS_RULESET, FPS_VERSION, type Replay } from '../../sim/fps/types'
import { FPS_REPLAY_CODEC, FPS_STATE_DOMAIN, verifyFpsTerminal } from './codec'

/** Structurally matches A's FreePlayInput; no shared client copy or runtime import. */
export interface FpsFreePlayInput {
    clientRunId: string; game: 'barricade'; rules: typeof FPS_RULESET; simVersion: typeof FPS_VERSION
    seed: string; replayCodec: typeof FPS_REPLAY_CODEC; replay: string; finishReason: 'won' | 'lost'; claimedScore: number
}
export interface FpsSnapshotPorts<T> {
    /** Inject A's hashFreePlayFields (SHA256 over UTF-8 fields prefixed uint32 BE). */
    hashFields(...fields: string[]): Promise<string>
    /** Inject A's createFreePlaySnapshot. Its session owns persistence/auth/transport. */
    createSnapshot(input: FpsFreePlayInput): T
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Pure terminal adapter; the game consumer owns lifecycle, A owns publication. */
export async function prepareFpsTerminalSnapshot<T>(clientRunId: string, log: Replay, ports: FpsSnapshotPorts<T>) {
    if (!uuid.test(clientRunId)) throw new Error('invalid_fps_run_id')
    const verified = verifyFpsTerminal(log)
    const { state, canonicalState } = verified
    // Freeze primitive input synchronously, before either async digest can yield.
    const input: Readonly<FpsFreePlayInput> = Object.freeze({ clientRunId, game: 'barricade', rules: FPS_RULESET, simVersion: FPS_VERSION,
        seed: state.seed, replayCodec: FPS_REPLAY_CODEC, replay: verified.encoded, finishReason: state.phase === 'won' ? 'won' : 'lost', claimedScore: state.score })
    const [stateHash, replayHash] = await Promise.all([
        ports.hashFields(FPS_STATE_DOMAIN, canonicalState),
        ports.hashFields('memba:free-replay:v1', input.game, input.rules, String(input.simVersion), input.seed, input.replayCodec, input.replay),
    ])
    if (![stateHash, replayHash].every(h => /^[0-9a-f]{64}$/.test(h))) throw new Error('invalid_fps_commitment')
    // The caller owns mounting/disposal; no API action occurs in this adapter.
    return Object.freeze({ input, snapshot: ports.createSnapshot(input), stateHash, replayHash, canonicalState })
}
