/** Dormant v2 client. Endpoint, authentication and active network are injected. */
export const FREE_PLAY_REALM = 'gno.land/r/samcrew/memba_arcade_scores_v2'
export const FREE_PLAY_PREFIX = '/api/arcade/free-play/v1/'
export type FreePlayGame = 'block-party' | 'space-invaders' | 'barricade'
export interface FreePlayTarget { chainId: string; realm: string }
export interface FreePlayIdentity { player: string; chainId: string; revision: string }
export interface FreePlayBinding { player: string; target: FreePlayTarget }
export interface FreePlayInput {
    clientRunId: string; game: FreePlayGame; rules: string; simVersion: number
    seed: string; replayCodec: string; replay: string; finishReason: string; claimedScore: number
}
export interface FreePlayEntry {
    game: FreePlayGame; player: string; rules: string; simVersion: number; runID: string
    seed: string; score: number; stateHash: string; replayHash: string
}
export interface FreePlayReceipt { target: FreePlayTarget; entry: FreePlayEntry; height: number; attester: string; schemaVersion: 2; txHash?: string }
export interface FreePlayRun {
    target: FreePlayTarget; entry: FreePlayEntry; clientRunId: string; payloadHash: string
    replayCodec: string; replay: string; status: 'verified' | 'queued' | 'submitted' | 'confirmed'
    receipt?: FreePlayReceipt; lastError?: string; nextCheckAt?: number
}
export interface FreePlayQuote {
    quoteId: string; runID: string; payloadHash: string; nonce: string; expiresAt: number
    payer: 'studio'; maxFeeUgnot: number; maxDepositUgnot: number
}
export interface FreePlayPublishRequest { payloadHash: string; quoteId: string; nonce: string }
export interface FreePlayAuth {
    /** revision changes on every wallet/network/session transition, including A→B→A. */
    identity(): FreePlayIdentity | null
    subscribe(listener: () => void): () => void
    token(identity: FreePlayIdentity, signal: AbortSignal): Promise<{ token: string; identity: FreePlayIdentity }>
}
export class FreePlayError extends Error {
    constructor(public readonly code: string) { super(code); this.name = 'FreePlayError' }
}
const hex = /^[0-9a-f]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const address = /^g1[0-9a-z]{38}$/
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const safe = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= max
const game = (v: unknown): v is FreePlayGame => v === 'block-party' || v === 'space-invaders' || v === 'barricade'
export function sameFreePlayTarget(a: FreePlayTarget, b: FreePlayTarget): boolean { return a.chainId === b.chainId && a.realm === b.realm }
export function validFreePlayTarget(v: unknown): v is FreePlayTarget {
    return record(v) && typeof v.chainId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v.chainId) && v.realm === FREE_PLAY_REALM
}
export function validFreePlayBinding(v: unknown): v is FreePlayBinding {
    return record(v) && typeof v.player === 'string' && address.test(v.player) && validFreePlayTarget(v.target)
}
export function validFreePlayInput(v: unknown): v is FreePlayInput {
    return record(v) && typeof v.clientRunId === 'string' && uuid.test(v.clientRunId) && game(v.game)
        && typeof v.rules === 'string' && /^[a-z0-9-]{1,48}$/.test(v.rules)
        && safe(v.simVersion) && v.simVersion > 0 && v.simVersion <= 2147483647 && text(v.seed, 128)
        && text(v.replayCodec, 64) && typeof v.replay === 'string' && v.replay.length > 0 && v.replay.length <= 1_000_000
        && typeof v.finishReason === 'string' && /^[a-z][a-z-]{0,31}$/.test(v.finishReason) && safe(v.claimedScore)
}
export function validFreePlayEntry(v: unknown): v is FreePlayEntry {
    return record(v) && game(v.game) && typeof v.player === 'string' && address.test(v.player)
        && typeof v.rules === 'string' && /^[a-z0-9-]{1,48}$/.test(v.rules)
        && safe(v.simVersion) && v.simVersion > 0 && v.simVersion <= 2147483647 && text(v.seed, 128) && safe(v.score)
        && typeof v.runID === 'string' && hex.test(v.runID) && typeof v.replayHash === 'string' && hex.test(v.replayHash)
        && typeof v.stateHash === 'string' && /^(?:[0-9a-f]{8}|[0-9a-f]{64})$/.test(v.stateHash)
}
export function sameFreePlayEntry(a: FreePlayEntry, b: FreePlayEntry): boolean {
    return a.game === b.game && a.player === b.player && a.rules === b.rules && a.simVersion === b.simVersion
        && a.runID === b.runID && a.seed === b.seed && a.score === b.score && a.stateHash === b.stateHash && a.replayHash === b.replayHash
}
export function validFreePlayReceipt(v: unknown): v is FreePlayReceipt {
    return record(v) && validFreePlayTarget(v.target) && validFreePlayEntry(v.entry) && v.schemaVersion === 2
        && safe(v.height) && v.height > 0 && typeof v.attester === 'string' && address.test(v.attester)
        && (v.txHash === undefined || typeof v.txHash === 'string' && hex.test(v.txHash))
}
export function validFreePlayRun(v: unknown): v is FreePlayRun {
    if (!record(v) || !validFreePlayTarget(v.target) || !validFreePlayEntry(v.entry)
        || typeof v.clientRunId !== 'string' || !uuid.test(v.clientRunId) || typeof v.payloadHash !== 'string' || !hex.test(v.payloadHash)
        || !text(v.replayCodec, 64) || typeof v.replay !== 'string' || v.replay.length > 1_000_000
        || !['verified', 'queued', 'submitted', 'confirmed'].includes(String(v.status))
        || v.nextCheckAt !== undefined && !safe(v.nextCheckAt) || v.lastError !== undefined && !text(v.lastError, 1024)) return false
    if (v.status !== 'confirmed') return v.receipt === undefined
    return validFreePlayReceipt(v.receipt) && sameFreePlayTarget(v.receipt.target, v.target) && sameFreePlayEntry(v.receipt.entry, v.entry)
}
export function validFreePlayQuote(v: unknown): v is FreePlayQuote {
    return record(v) && ['quoteId', 'runID', 'payloadHash', 'nonce'].every(k => typeof v[k] === 'string' && hex.test(v[k]))
        && v.payer === 'studio' && safe(v.expiresAt) && v.expiresAt <= 8640000000000 && safe(v.maxFeeUgnot) && v.maxFeeUgnot > 0 && safe(v.maxDepositUgnot) && v.maxDepositUgnot > 0
}
export function validFreePlayPublishRequest(v: unknown): v is FreePlayPublishRequest {
    return record(v) && ['payloadHash', 'quoteId', 'nonce'].every(k => typeof v[k] === 'string' && hex.test(v[k]))
}
export async function hashFreePlayFields(...fields: string[]): Promise<string> {
    const encoded = fields.map(f => new TextEncoder().encode(f))
    const bytes = new Uint8Array(encoded.reduce((n, f) => n + 4 + f.length, 0))
    const view = new DataView(bytes.buffer)
    let offset = 0
    for (const field of encoded) { view.setUint32(offset, field.length); offset += 4; bytes.set(field, offset); offset += field.length }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
export function freePlayRunID(binding: FreePlayBinding, input: FreePlayInput): Promise<string> {
    return hashFreePlayFields('memba:free-run:v1', binding.target.chainId, binding.target.realm, binding.player, input.game, input.clientRunId)
}
async function validateRun(raw: unknown, binding: FreePlayBinding, input: FreePlayInput): Promise<FreePlayRun> {
    if (!validFreePlayRun(raw)) throw new FreePlayError('invalid_response')
    const e = raw.entry
    const [id, replay, payload] = await Promise.all([
        freePlayRunID(binding, input),
        hashFreePlayFields('memba:free-replay:v1', input.game, input.rules, String(input.simVersion), input.seed, input.replayCodec, input.replay),
        hashFreePlayFields('memba:free-anchor:v1', binding.target.chainId, binding.target.realm, e.runID, e.player, e.game, e.rules, String(e.simVersion), e.seed, String(e.score), e.stateHash, e.replayHash),
    ])
    if (!sameFreePlayTarget(raw.target, binding.target) || e.player !== binding.player || raw.clientRunId !== input.clientRunId
        || e.game !== input.game || e.rules !== input.rules || e.simVersion !== input.simVersion || e.seed !== input.seed
        || e.score !== input.claimedScore || raw.replay !== input.replay || raw.replayCodec !== input.replayCodec
        || e.runID !== id || e.replayHash !== replay || raw.payloadHash !== payload) throw new FreePlayError('run_conflict')
    return raw
}
export interface FreePlayClient {
    subscribeIdentity(listener: () => void): () => void
    bind(): FreePlayBinding
    verify(binding: FreePlayBinding, input: FreePlayInput, signal: AbortSignal): Promise<FreePlayRun>
    read(binding: FreePlayBinding, input: FreePlayInput, signal: AbortSignal): Promise<FreePlayRun>
    quote(binding: FreePlayBinding, input: FreePlayInput, run: FreePlayRun, signal: AbortSignal): Promise<FreePlayQuote>
    publish(binding: FreePlayBinding, input: FreePlayInput, request: FreePlayPublishRequest, signal: AbortSignal): Promise<FreePlayRun>
}
export function createFreePlayClient(options: { origin: string; target: FreePlayTarget; auth: FreePlayAuth; fetch: typeof fetch }): FreePlayClient {
    const endpoint = new URL(options.origin)
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || !validFreePlayTarget(options.target)) throw new FreePlayError('invalid_endpoint')
    const target = { ...options.target }
    const sameIdentity = (a: FreePlayIdentity | null, b: FreePlayIdentity) => a?.player === b.player && a.chainId === b.chainId && a.revision === b.revision
    const assertIdentity = (binding: FreePlayBinding): FreePlayIdentity => {
        const identity = options.auth.identity()
        if (!validFreePlayBinding(binding) || !sameFreePlayTarget(binding.target, target) || !identity || identity.player !== binding.player || identity.chainId !== target.chainId) throw new FreePlayError('identity_changed')
        return { ...identity }
    }
    async function request<T>(binding: FreePlayBinding, signal: AbortSignal, path: string, body: unknown | undefined, decode: (v: unknown) => Promise<T>): Promise<T> {
        const identity = assertIdentity(binding)
        const check = () => { if (signal.aborted) throw new FreePlayError('cancelled'); if (!sameIdentity(options.auth.identity(), identity)) throw new FreePlayError('identity_changed') }
        check()
        const token = await options.auth.token(identity, signal)
        check()
        if (!token.token || !sameIdentity(token.identity, identity)) throw new FreePlayError('identity_changed')
        const response = await options.fetch(new URL(FREE_PLAY_PREFIX + path, endpoint), {
            method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
            headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        check()
        const raw: unknown = await response.json()
        check()
        if (!response.ok) throw new FreePlayError(record(raw) && typeof raw.error === 'string' && /^[a-z_]{1,64}$/.test(raw.error) ? raw.error : 'service_unavailable')
        const value = await decode(raw)
        check()
        return value
    }
    const ensureInput = (input: FreePlayInput) => { if (!validFreePlayInput(input) || new TextEncoder().encode(JSON.stringify(input)).length > (1 << 20)) throw new FreePlayError('invalid_snapshot') }
    return {
        subscribeIdentity: listener => options.auth.subscribe(listener),
        bind() { const identity = options.auth.identity(); const binding = { player: identity?.player ?? '', target: { ...target } }; assertIdentity(binding); return binding },
        async verify(binding, input, signal) { ensureInput(input); return request(binding, signal, 'verify', input, v => validateRun(v, binding, input)) },
        async read(binding, input, signal) { ensureInput(input); return request(binding, signal, `runs/${await freePlayRunID(binding, input)}`, undefined, v => validateRun(v, binding, input)) },
        async quote(binding, input, run, signal) {
            ensureInput(input)
            await validateRun(run, binding, input)
            return request(binding, signal, `runs/${run.entry.runID}/quote`, {}, async v => {
                if (!validFreePlayQuote(v) || v.runID !== run.entry.runID || v.payloadHash !== run.payloadHash) throw new FreePlayError('invalid_quote')
                return v
            })
        },
        async publish(binding, input, body, signal) {
            ensureInput(input)
            if (!validFreePlayPublishRequest(body)) throw new FreePlayError('invalid_quote')
            return request(binding, signal, `runs/${await freePlayRunID(binding, input)}/publish`, body, async v => {
                const run = await validateRun(v, binding, input)
                if (run.payloadHash !== body.payloadHash) throw new FreePlayError('run_conflict')
                return run
            })
        },
    }
}
