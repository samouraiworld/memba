import {
    FreePlayError, validFreePlayBinding, validFreePlayInput, validFreePlayPublishRequest, validFreePlayRun,
    type FreePlayBinding, type FreePlayEntry, type FreePlayInput, type FreePlayPublishRequest, type FreePlayReceipt, type FreePlayRun,
} from '../../../lib/arcadeFreePlay'

export interface FreePlaySnapshot {
    schemaVersion: 1
    input: FreePlayInput
    binding?: FreePlayBinding
    result?: Pick<FreePlayRun, 'entry' | 'payloadHash' | 'status' | 'receipt'>
    publication?: FreePlayPublishRequest
}
export interface SnapshotStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const key = (id: string) => `memba:arcade:freeplay:v1:${id}`
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const entry = (e: FreePlayEntry): FreePlayEntry => ({ game: e.game, player: e.player, rules: e.rules, simVersion: e.simVersion, runID: e.runID, seed: e.seed, score: e.score, stateHash: e.stateHash, replayHash: e.replayHash })
const receipt = (r: FreePlayReceipt): FreePlayReceipt => ({ target: { chainId: r.target.chainId, realm: r.target.realm }, entry: entry(r.entry), height: r.height, attester: r.attester, schemaVersion: 2, ...(r.txHash ? { txHash: r.txHash } : {}) })
/** Project an allowlist: tokens, identity revisions and arbitrary extras never persist. */
export function sanitizeSnapshot(raw: unknown): FreePlaySnapshot {
    if (!object(raw) || raw.schemaVersion !== 1 || !validFreePlayInput(raw.input)) throw new FreePlayError('invalid_snapshot')
    const i = raw.input
    const snapshot: FreePlaySnapshot = { schemaVersion: 1, input: { clientRunId: i.clientRunId, game: i.game, rules: i.rules, simVersion: i.simVersion, seed: i.seed, replayCodec: i.replayCodec, replay: i.replay, finishReason: i.finishReason, claimedScore: i.claimedScore } }
    if (raw.binding !== undefined) {
        if (!validFreePlayBinding(raw.binding)) throw new FreePlayError('invalid_snapshot')
        snapshot.binding = { player: raw.binding.player, target: { chainId: raw.binding.target.chainId, realm: raw.binding.target.realm } }
    }
    if (raw.result !== undefined) {
        if (!object(raw.result) || !snapshot.binding) throw new FreePlayError('invalid_snapshot')
        const run = { ...raw.result, target: snapshot.binding.target, clientRunId: i.clientRunId, replay: i.replay, replayCodec: i.replayCodec }
        if (!validFreePlayRun(run) || run.entry.player !== snapshot.binding.player || run.entry.game !== i.game || run.entry.rules !== i.rules || run.entry.simVersion !== i.simVersion || run.entry.seed !== i.seed || run.entry.score !== i.claimedScore) throw new FreePlayError('invalid_snapshot')
        snapshot.result = { entry: entry(run.entry), payloadHash: run.payloadHash, status: run.status, ...(run.receipt ? { receipt: receipt(run.receipt) } : {}) }
    }
    if (raw.publication !== undefined) {
        if (!validFreePlayPublishRequest(raw.publication) || !snapshot.result || raw.publication.payloadHash !== snapshot.result.payloadHash) throw new FreePlayError('invalid_snapshot')
        snapshot.publication = { payloadHash: raw.publication.payloadHash, quoteId: raw.publication.quoteId, nonce: raw.publication.nonce }
    }
    return snapshot
}
export function createFreePlaySnapshot(input: FreePlayInput): FreePlaySnapshot { return sanitizeSnapshot({ schemaVersion: 1, input }) }
export function snapshotRun(snapshot: FreePlaySnapshot): FreePlayRun | undefined {
    if (!snapshot.binding || !snapshot.result) return undefined
    return { ...snapshot.result, target: snapshot.binding.target, clientRunId: snapshot.input.clientRunId, replayCodec: snapshot.input.replayCodec, replay: snapshot.input.replay }
}
export function saveFreePlaySnapshot(storage: SnapshotStorage, snapshot: FreePlaySnapshot): void {
    const clean = sanitizeSnapshot(snapshot)
    storage.setItem(key(clean.input.clientRunId), JSON.stringify(clean))
}
export function loadFreePlaySnapshot(storage: SnapshotStorage, id: string): FreePlaySnapshot | null {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new FreePlayError('invalid_snapshot')
    const raw = storage.getItem(key(id))
    if (raw === null) return null
    if (raw.length > 1_100_000) throw new FreePlayError('invalid_snapshot')
    let decoded: unknown
    try { decoded = JSON.parse(raw) } catch { throw new FreePlayError('invalid_snapshot') }
    const snapshot = sanitizeSnapshot(decoded)
    if (snapshot.input.clientRunId !== id) throw new FreePlayError('invalid_snapshot')
    return snapshot
}
