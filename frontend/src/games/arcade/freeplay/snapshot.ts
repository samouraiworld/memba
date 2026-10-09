import {
    FreePlayError, validFreePlayBinding, validFreePlayInput, validFreePlayPublishRequest, validFreePlayRun,
    type FreePlayBinding, type FreePlayEntry, type FreePlayGame, type FreePlayInput, type FreePlayPublishRequest, type FreePlayReceipt, type FreePlayRun,
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
    // Read the bounded index before writing: corrupt metadata must not silently
    // replace the list. The canonical snapshot remains the only run storage.
    const index = readSnapshotIndex(storage)
    const item = { clientRunId: clean.input.clientRunId, game: clean.input.game }
    const counts = new Map<FreePlayGame, number>()
    const recent = [item, ...index.filter(row => row.clientRunId !== item.clientRunId)].filter(row => {
        const count = (counts.get(row.game) ?? 0) + 1
        counts.set(row.game, count)
        return count <= FREE_PLAY_RECENT_PER_GAME
    })
    storage.setItem(key(clean.input.clientRunId), JSON.stringify(clean))
    // A quota failure here surfaces to the caller before any publication I/O.
    // The snapshot already written can still be exported or loaded by its ID.
    storage.setItem(indexKey, JSON.stringify({ schemaVersion: 1, entries: recent }))
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


export const FREE_PLAY_RECENT_PER_GAME = 20
const indexKey = 'memba:arcade:freeplay:index:v1'
interface SnapshotIndexEntry { clientRunId: string; game: FreePlayGame }
const games: readonly FreePlayGame[] = ['block-party', 'space-invaders', 'barricade']
function readSnapshotIndex(storage: SnapshotStorage): SnapshotIndexEntry[] {
    const raw = storage.getItem(indexKey)
    if (raw === null) return []
    if (raw.length > 16384) throw new FreePlayError('invalid_snapshot_index')
    let decoded: unknown
    try { decoded = JSON.parse(raw) } catch { throw new FreePlayError('invalid_snapshot_index') }
    if (!object(decoded) || decoded.schemaVersion !== 1 || !Array.isArray(decoded.entries)
        || decoded.entries.length > games.length * FREE_PLAY_RECENT_PER_GAME) throw new FreePlayError('invalid_snapshot_index')
    const seen = new Set<string>()
    const counts = new Map<FreePlayGame, number>()
    return decoded.entries.map(row => {
        if (!object(row) || typeof row.clientRunId !== 'string' || row.clientRunId.length !== 36
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.clientRunId)
            || !games.includes(row.game as FreePlayGame) || seen.has(row.clientRunId)) throw new FreePlayError('invalid_snapshot_index')
        seen.add(row.clientRunId)
        const game = row.game as FreePlayGame
        const count = (counts.get(game) ?? 0) + 1
        if (count > FREE_PLAY_RECENT_PER_GAME) throw new FreePlayError('invalid_snapshot_index')
        counts.set(game, count)
        return { clientRunId: row.clientRunId, game }
    })
}
export interface FreePlaySavedRuns {
    /** Saved data only. Construct a session and refresh before showing confirmed. */
    snapshots: FreePlaySnapshot[]
    /** Count of missing/corrupt snapshots in this page; never silently confirmed. */
    unavailable: number
    total: number
    nextOffset?: number
}
/** At most20 snapshots per read; the index retains20 recent IDs per game.
 * No API call, wallet connection, token access, polling or confirmation occurs.
 */
export function listFreePlaySnapshots(storage: SnapshotStorage, options: { game?: FreePlayGame; offset?: number; limit?: number } = {}): FreePlaySavedRuns {
    const { game, offset = 0, limit = 10 } = options
    if (game !== undefined && !games.includes(game) || !Number.isSafeInteger(offset) || offset < 0 || offset > 60
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new FreePlayError('invalid_snapshot_query')
    const rows = readSnapshotIndex(storage).filter(row => game === undefined || row.game === game)
    const page = rows.slice(offset, offset + limit)
    const snapshots: FreePlaySnapshot[] = []
    let unavailable = 0
    for (const row of page) {
        try {
            const snapshot = loadFreePlaySnapshot(storage, row.clientRunId)
            if (!snapshot || snapshot.input.game !== row.game) { unavailable++; continue }
            snapshots.push(snapshot)
        } catch { unavailable++ }
    }
    const nextOffset = offset + page.length
    return { snapshots, unavailable, total: rows.length, ...(nextOffset < rows.length ? { nextOffset } : {}) }
}


/** Write both records, then verify the exact canonical bytes and index membership.
 * This proves recoverability in this storage now, not indefinite retention or a
 * transaction across tabs. Call again immediately before leaving for Connect.
 */
export function persistFreePlaySnapshot(storage: SnapshotStorage, snapshot: FreePlaySnapshot): FreePlaySnapshot {
    const clean = sanitizeSnapshot(snapshot)
    try {
        const prior = loadFreePlaySnapshot(storage, clean.input.clientRunId)
        if (prior && (JSON.stringify(prior.input) !== JSON.stringify(clean.input)
            || prior.binding && JSON.stringify(prior.binding) !== JSON.stringify(clean.binding)
            || prior.publication && !clean.publication)) throw new FreePlayError('run_conflict')
        saveFreePlaySnapshot(storage, clean)
        const saved = loadFreePlaySnapshot(storage, clean.input.clientRunId)
        if (!saved || JSON.stringify(saved) !== JSON.stringify(clean)
            || !readSnapshotIndex(storage).some(row => row.clientRunId === clean.input.clientRunId && row.game === clean.input.game)) {
            throw new FreePlayError('storage_unavailable')
        }
        return saved
    } catch (error) {
        if (error instanceof FreePlayError && error.code === 'run_conflict') throw error
        throw new FreePlayError('storage_unavailable')
    }
}

/** Local-only guard for completed results. Prefer the canonical record so an
 * older mounted wrapper cannot erase an existing binding or publication consent.
 * Never binds a wallet, generates an ID, connects, or calls the API.
 */
export function prepareFreePlayRecovery(storage: SnapshotStorage, snapshot: FreePlaySnapshot): FreePlaySnapshot {
    const clean = sanitizeSnapshot(snapshot)
    let stored: FreePlaySnapshot | null
    try { stored = loadFreePlaySnapshot(storage, clean.input.clientRunId) }
    catch { throw new FreePlayError('storage_unavailable') }
    if (stored && (JSON.stringify(stored.input) !== JSON.stringify(clean.input)
        || clean.binding && JSON.stringify(stored.binding) !== JSON.stringify(clean.binding)
        || clean.publication && JSON.stringify(stored.publication) !== JSON.stringify(clean.publication))) throw new FreePlayError('run_conflict')
    return persistFreePlaySnapshot(storage, stored ?? clean)
}
