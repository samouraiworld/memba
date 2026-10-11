/** Dedicated, reproducible Free play bundle, dormant until explicitly configured.
 * Imports the reviewed B/C codecs and engines directly.
 * No legacy Daily/Classic dispatch and no second implementation of either sim.
 */
import { createHash } from 'node:crypto'
import { SI_FREE_RULES, SI_FREE_CODEC, SI_FREE_VERSION, verifyFreePlayInput, type SpaceInvadersFreePlayInput } from '../../../../frontend/src/games/space-invaders/lib/freePlayCodec'
import { decodeFpsReplay, verifyFpsTerminal, FPS_REPLAY_CODEC, FPS_STATE_DOMAIN } from '../../../../frontend/src/games/barricade/fps/freeplay/codec'
import { FPS_RULESET, FPS_VERSION } from '../../../../frontend/src/games/barricade/sim/fps/types'

type Input = {
    clientRunId: string; game: string; rules: string; simVersion: number; seed: string
    replayCodec: string; replay: string; finishReason: string; claimedScore: number
}
export type FreePlayWorkerResult = { ok: false; error: string } | {
    ok: true; game: string; rules: string; simVersion: number; finishReason: string
    score: number; stateHash: string; replayHash: string
}
const MAX_INPUT_BYTES = 1 << 20
const fields = ['clientRunId', 'game', 'rules', 'simVersion', 'seed', 'replayCodec', 'replay', 'finishReason', 'claimedScore']
const safeScore = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0)
function inputShape(value: unknown): value is Input {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const input = value as Record<string, unknown>
    if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) return false
    return typeof input.clientRunId === 'string' && input.clientRunId.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.clientRunId)
        && typeof input.game === 'string' && typeof input.rules === 'string'
        && typeof input.simVersion === 'number' && Number.isSafeInteger(input.simVersion)
        && typeof input.seed === 'string' && input.seed.length > 0 && input.seed.length <= 128 && !/[^a-zA-Z0-9:_-]/.test(input.seed)
        && typeof input.replayCodec === 'string' && typeof input.replay === 'string'
        && input.replay.length > 0 && input.replay.length <= 1_000_000
        && typeof input.finishReason === 'string' && safeScore(input.claimedScore)
}
function hashFields(...values: string[]): string {
    const hash = createHash('sha256')
    for (const value of values) {
        const bytes = Buffer.from(value, 'utf8')
        const length = Buffer.alloc(4)
        length.writeUInt32BE(bytes.length)
        hash.update(length).update(bytes)
    }
    return hash.digest('hex')
}
const errors = new Set([
    'invalid_replay', 'not_terminal', 'unsupported_version', 'unsupported_rules',
    'claimed_result_mismatch', 'certification_limit', 'invalid_run_identity',
    'invalid_fps_replay', 'invalid_fps_event_order', 'invalid_fps_direction',
    'invalid_fps_event', 'unsupported_fps_rules', 'rejected_fps_action',
    'trailing_fps_input', 'fps_not_terminal',
])

/** Pure bounded dispatcher; even direct callers cannot select a legacy engine. */
export function processFreePlayJob(raw: string): FreePlayWorkerResult {
    if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) return { ok: false, error: 'certification_limit' }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { ok: false, error: 'invalid_replay' } }
    if (!inputShape(parsed)) return { ok: false, error: 'invalid_replay' }
    const input = parsed
    let score: number, stateHash: string, finishReason: string
    try {
        if (input.game === 'space-invaders') {
            if (input.rules !== SI_FREE_RULES || input.replayCodec !== SI_FREE_CODEC) return { ok: false, error: 'unsupported_rules' }
            if (input.simVersion !== SI_FREE_VERSION) return { ok: false, error: 'unsupported_version' }
            const result = verifyFreePlayInput(input as SpaceInvadersFreePlayInput)
            score = result.score; stateHash = result.stateHash; finishReason = 'game-over'
        } else if (input.game === 'barricade') {
            if (input.rules !== FPS_RULESET || input.replayCodec !== FPS_REPLAY_CODEC) return { ok: false, error: 'unsupported_rules' }
            if (input.simVersion !== FPS_VERSION) return { ok: false, error: 'unsupported_version' }
            if (input.finishReason !== 'won' && input.finishReason !== 'lost') return { ok: false, error: 'not_terminal' }
            const result = verifyFpsTerminal(decodeFpsReplay(input.seed, input.replay))
            // Consumers already emit this canonical form. Reject alternate JSON
            // spellings so Go/client commitments bind the same exact transcript.
            if (result.encoded !== input.replay) return { ok: false, error: 'noncanonical_replay' }
            score = result.state.score
            stateHash = hashFields(FPS_STATE_DOMAIN, result.canonicalState)
            finishReason = result.state.phase
        } else return { ok: false, error: 'unsupported_rules' }
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code : error instanceof Error ? error.message : ''
        if (errors.has(code)) return { ok: false, error: code }
        // An unexpected engine/runtime failure is infrastructure failure, not
        // proof that a player's replay is invalid. Let the process exit nonzero.
        throw error
    }
    if (finishReason !== input.finishReason) return { ok: false, error: 'not_terminal' }
    if (!safeScore(score) || score !== input.claimedScore) return { ok: false, error: 'claimed_result_mismatch' }
    if (!/^(?:[0-9a-f]{8}|[0-9a-f]{64})$/.test(stateHash)) return { ok: false, error: 'invalid_worker_result' }
    return {
        ok: true, game: input.game, rules: input.rules, simVersion: input.simVersion, finishReason,
        score, stateHash,
        replayHash: hashFields('memba:free-replay:v1', input.game, input.rules, String(input.simVersion), input.seed, input.replayCodec, input.replay),
    }
}

// One capped stdin envelope → one compact verdict. The Go process runner will
// additionally bound concurrency, timeout, stdout and stderr when connected.
if (require.main === module) {
    const chunks: Buffer[] = []
    let bytes = 0, ended = false
    const reply = (result: FreePlayWorkerResult) => {
        if (ended) return
        ended = true
        process.stdout.write(JSON.stringify(result) + '\n')
    }
    process.stdin.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_INPUT_BYTES) { reply({ ok: false, error: 'certification_limit' }); process.stdin.destroy(); return }
        if (!ended) chunks.push(chunk)
    })
    process.stdin.on('end', () => { if (!ended) reply(processFreePlayJob(Buffer.concat(chunks).toString('utf8'))) })
    process.stdin.on('error', () => reply({ ok: false, error: 'invalid_replay' }))
}
