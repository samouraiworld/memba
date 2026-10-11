import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { init, tick } from '../../sim/fps/engine'
import { FPS_RULESET, FPS_VERSION, terminal, type Replay } from '../../sim/fps/types'
import { canonicalFpsReplay, decodeFpsReplay, verifyFpsTerminal } from './codec'
import { prepareFpsTerminalSnapshot } from './terminal'

const id = 'd22adcc5-32d3-4fe3-85ec-4cb545ca070a'
const won = JSON.parse(readFileSync('src/games/barricade/fps/freeplay/fixtures/won-repair.json', 'utf8')) as Replay
function lostLog(): Replay {
    let s = init('fps-c2-fixture')
    while (!terminal(s)) s = tick(s)
    return { seed: s.seed, ruleset: FPS_RULESET, version: FPS_VERSION, events: [], finalTick: s.tick }
}
// Independent Node implementation for the handoff vectors; production injects A's helper.
async function hashFields(...fields: string[]) {
    const hash = createHash('sha256')
    for (const field of fields) { const value = Buffer.from(field, 'utf8'), length = Buffer.alloc(4); length.writeUInt32BE(value.length); hash.update(length); hash.update(value) }
    return hash.digest('hex')
}
const ports = { hashFields, createSnapshot: (input: unknown) => ({ schemaVersion: 1, input }) }
describe('FPS dormant free-play preparation', () => {
    it('exports fixed terminal vectors for a win with repair and an unattended loss', async () => {
        const vectors = []
        for (const [name, log] of [['won-repair', won], ['lost-unattended', lostLog()]] as const) {
            const prepared = await prepareFpsTerminalSnapshot(name === 'won-repair' ? id : '7c2a410e-fd50-4e44-9065-8c20b2d9b720', log, ports)
            vectors.push({ name, ...prepared.input, stateHash: prepared.stateHash, replayHash: prepared.replayHash, canonicalState: prepared.canonicalState })
        }
        const file = 'src/games/barricade/fps/freeplay/fixtures/terminal-vectors.json'
        if (process.env.UPDATE_FPS_FIXTURES === '1') writeFileSync(file, JSON.stringify(vectors, null, 2) + '\n')
        expect(vectors).toEqual(JSON.parse(readFileSync(file, 'utf8')))
        expect(vectors[0].finishReason).toBe('won'); expect(vectors[1].finishReason).toBe('lost')
    })
    it('normalizes JSON whitespace by reconstructing the canonical array transcript', () => {
        const encoded = canonicalFpsReplay(won), decorated = JSON.stringify(JSON.parse(encoded), null, 2)
        expect(canonicalFpsReplay(decodeFpsReplay(won.seed, decorated))).toBe(encoded)
        expect(verifyFpsTerminal(decodeFpsReplay(won.seed, decorated)).state.phase).toBe('won')
    })
    it('rejects incomplete, invalid, rejected, out-of-order or trailing actions', () => {
        const lost = lostLog()
        expect(() => verifyFpsTerminal({ ...lost, finalTick: 1 })).toThrow('fps_not_terminal')
        expect(() => verifyFpsTerminal({ ...lost, finalTick: lost.finalTick + 1 })).toThrow('trailing_fps_input')
        expect(() => verifyFpsTerminal({ ...lost, events: [{ tick: 0, type: 'reload' }] })).toThrow('rejected_fps_action')
        for (const wire of ['[20,[[2,"R"],[1,"C"]]]', '[20,[[20,"R"]]]', '[20,[[0,"F",0,0,1]]]', '[20,[[0,"F",0,0,-10000,1]]]', '[20,[[0,"Q"]]]', '[20,[[0,"R",1]]]', '[10801,[]]']) {
            expect(() => decodeFpsReplay(lost.seed, wire)).toThrow()
        }
        expect(() => canonicalFpsReplay({ ...lost, events: [{ tick: 0, type: 'fire', direction: { x: -0, y: 0, z: -10000 } }] })).toThrow()
        expect(() => canonicalFpsReplay({ ...lost, finalTick: NaN })).toThrow()
        expect(() => decodeFpsReplay('unsupported seed ☃', '[20,[]]')).toThrow()
    })
    it('captures immutable primitives before digest awaits and never regenerates run identity', async () => {
        const log = structuredClone(won), original = canonicalFpsReplay(log)
        const pending = prepareFpsTerminalSnapshot(id, log, ports)
        log.events.length = 0; log.seed = 'changed'; log.finalTick = 1
        const prepared = await pending
        expect(prepared.input.replay).toBe(original); expect(prepared.input.clientRunId).toBe(id)
        expect(prepared.input.seed).toBe(won.seed); expect(Object.isFrozen(prepared.input)).toBe(true)
        expect(prepared.snapshot.input).toBe(prepared.input)
        await expect(prepareFpsTerminalSnapshot(id.toUpperCase(), won, ports)).rejects.toThrow('invalid_fps_run_id')
        await expect(prepareFpsTerminalSnapshot(id, won, { ...ports, hashFields: async () => 'fnv16' })).rejects.toThrow('invalid_fps_commitment')
    })
})
