import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore } from '../drafts'
import type { NotesStore } from '../drafts'
import { createNotesIntents, validIdentityVerification } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { blob, encode64, NOTES_REALM } from '../chain/schema'
import { NotesIdentityController, type IdentitySetupPlan } from './controller'
import { identityIntentScope, prepareIdentitySetupRequest } from './request'
import type { IdentityQuoteProvider, IdentityRequestOptions } from './request'
import { recoverIdentityIntent } from './requestRecovery'
import golden from './__fixtures__/backup-standard.json'

const network = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn(), kdf: vi.fn() }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => network.kdf(...args) }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500000000, doContractBroadcast: (...args: unknown[]) => network.send(...args), freshFeeForGasWanted: (...args: unknown[]) => network.fee(...args), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
const owner = bech32Encode('g', hexToBytes(golden.addressHex)), op = '44'.repeat(16)
const stores: NotesStore[] = []
function setup() {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  const plan: IdentitySetupPlan = { mode: 'standard', operationId: op, expectedGeneration: 0n, expectedBackupRevision: 0n, generation: 1n, publicKey: blob(golden.publicKeyBase64, 1216), backup: blob(golden.recordBase64, 365), migrationPartial: false }
  let applied = false, operationId = op, enabled = true, locked = false
  const controller = { preparedPlan: vi.fn(() => { if (locked) throw new Error('locked'); return plan }), confirmSetup: vi.fn(async () => applied), lock: () => { locked = true } } as unknown as NotesIdentityController
  const client = { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: vi.fn(), height: vi.fn(async () => '10'),
    key: vi.fn(async () => ({ address: owner, generation: applied ? '1' : '0', active: applied, publicKey: applied ? plan.publicKey : new Uint8Array(), operationId: applied ? operationId : '', height: applied ? '11' : '0' })),
    seedBackupRaw: vi.fn(async () => applied ? { mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(hexToBytes(golden.publicKeyHashHex)), op_id: operationId, actor: owner, height: '11', record: golden.recordBase64 } : null),
  } as unknown as NotesReadClient
  const quote: IdentityQuoteProvider = async input => ({ requestDigest: input.requestDigest, chainId: input.chainId, atHeight: input.height, expiresAtHeight: '20', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '900000', maxDepositUgnot: '2000000', gasWanted: 60000000, networkFeeUgnot: 100000 })
  const options: IdentityRequestOptions = { controller, client, owner, caps: { registryUgnot: '1000000', backupUgnot: '1000000' }, quote, intents, session, isWriteEnabled: () => enabled }
  return { store, options, intents, session, controller, scope: identityIntentScope(golden.chainId, owner), apply: (id = op) => { applied = true; operationId = id }, disable: () => { enabled = false } }
}
async function realSetup() {
  const s = setup(), controller = new NotesIdentityController({ chainId: golden.chainId, realm: NOTES_REALM, address: owner, addressBytes: hexToBytes(golden.addressHex), session: s.session, isCurrent: () => true, read: async () => ({ generation: 0n, active: false, publicKey: new Uint8Array(), keyOperationId: '', keyHeight: 0n, backup: null }) })
  const output = await controller.prepareSetup('vault'); controller.confirmRecovery(output.phrase)
  return { ...s, controller, output, options: { ...s.options, controller } }
}
beforeEach(() => {
  vi.clearAllMocks(); network.fee.mockResolvedValue(90000)
  network.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
  network.send.mockImplementation(async (_messages, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })
describe('atomic identity setup signing', () => {
  it('reviews a new operation after a proven pre-wallet fee failure without replacing recovery material', async () => {
    const s = await realSetup(), original = s.controller.preparedPlan(), first = await prepareIdentitySetupRequest(s.options)
    const wallet = vi.fn(async () => () => true)
    network.fee.mockResolvedValueOnce(100001)
    await expect(first.send(undefined, wallet)).rejects.toThrow('fee changed')
    expect(wallet).not.toHaveBeenCalled()
    const prior = (await s.intents.get(s.scope, original.operationId))!
    expect(prior.phase).toBe('not-sent')
    const retry = await prepareIdentitySetupRequest(s.options), renewed = s.controller.preparedPlan()
    expect(renewed.operationId).not.toBe(original.operationId)
    expect(renewed).toEqual({ ...original, operationId: renewed.operationId })
    expect(s.controller.getSnapshot()).toMatchObject({ phase: 'prepared', recoveryConfirmed: true })
    const oldMessages = first.prepare(undefined).msgs, newMessages = retry.prepare(undefined).msgs
    expect(newMessages.map(message => (message.value.args as string[]).slice(0, -1))).toEqual(oldMessages.map(message => (message.value.args as string[]).slice(0, -1)))
    expect(retry.acks).toEqual(first.acks)
    await expect(first.recheck!(undefined)).rejects.toThrow('stale')
    await expect(first.send(undefined, wallet)).rejects.toThrow('stale')
    await retry.send(undefined, wallet)
    expect(wallet).toHaveBeenCalledTimes(1)
    const next = (await s.intents.get(s.scope, renewed.operationId))!
    expect(next.phase).toBe('submitted'); expect(next.requestDigest).not.toBe(prior.requestDigest)
    expect(await s.intents.get(s.scope, original.operationId)).toEqual(prior)
    s.controller.dispose()
  })
  it.each(['prepared', 'submitted', 'unknown'] as const)('never renews an existing %s operation', async phase => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    network.fee.mockResolvedValueOnce(100001)
    await expect(request.send(undefined, async () => {})).rejects.toThrow('fee changed')
    const previous = (await s.intents.get(s.scope, op))!, t = setup()
    expect((await t.intents.begin(previous, t.session.capture())).status).toBe('saved')
    if (phase !== 'prepared') expect((await t.intents.settle(t.scope, op, phase, t.session.capture())).status).toBe('saved')
    network.send.mockClear()
    await expect(prepareIdentitySetupRequest(t.options)).rejects.toThrow('stale')
    expect((await t.intents.get(t.scope, op))?.phase).toBe(phase)
    expect(t.controller.preparedPlan().operationId).toBe(op); expect(network.send).not.toHaveBeenCalled()
  })
  it('allows only one renewal when concurrent reviews read the same not-sent record', async () => {
    const s = await realSetup(), oldId = s.controller.preparedPlan().operationId, first = await prepareIdentitySetupRequest(s.options)
    network.fee.mockResolvedValueOnce(100001); await expect(first.send(undefined, async () => {})).rejects.toThrow('fee changed')
    const get = s.intents.get.bind(s.intents); let reads = 0, release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(s.intents, 'get').mockImplementation(async (scope, id) => { const value = await get(scope, id); if (++reads === 2) release(); await barrier; return value })
    const results = await Promise.allSettled([prepareIdentitySetupRequest(s.options), prepareIdentitySetupRequest(s.options)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(s.controller.preparedPlan().operationId).not.toBe(oldId)
    expect((await get(s.scope, oldId))?.phase).toBe('not-sent')
    s.controller.dispose()
  })
  it.each(['publicKeySha256', 'backupSha256', 'mode', 'generation', 'backupRevision', 'actor', 'scope'] as const)('does not renew a not-sent receipt with mismatched %s', async field => {
    const s = await realSetup(), plan = s.controller.preparedPlan(), first = await prepareIdentitySetupRequest(s.options)
    network.fee.mockResolvedValueOnce(100001); await expect(first.send(undefined, async () => {})).rejects.toThrow('fee changed')
    const db = await s.store.database.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('intents', 'readwrite'), store = tx.objectStore('intents'), read = store.getAll()
      read.onsuccess = () => {
        const value = read.result[0]
        if (field === 'generation') { value.expectedStateRevision = '1'; value.ownerGeneration = '1'; value.resultingStateRevision = '2'; value.verification.generation = '2' }
        else if (field === 'backupRevision') { value.expectedEpoch = '1'; value.verification.backupRevision = '2' }
        else if (field === 'actor') value.actor = bech32Encode('g', new Uint8Array(20).fill(3))
        else if (field === 'scope') value.scope.chainId = 'other-chain'
        else value.verification[field] = field === 'mode' ? 'standard' : 'aa'.repeat(32)
        store.put(value)
      }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    network.send.mockClear()
    await expect(prepareIdentitySetupRequest(s.options)).rejects.toThrow()
    expect(s.controller.preparedPlan()).toEqual(plan); expect(network.send).not.toHaveBeenCalled()
    s.controller.dispose()
  })
  it('refuses renewal if lock or session invalidation occurs during the journal read', async () => {
    for (const invalidate of ['lock', 'session'] as const) {
      const s = await realSetup(), id = s.controller.preparedPlan().operationId, first = await prepareIdentitySetupRequest(s.options)
      network.fee.mockResolvedValueOnce(100001); await expect(first.send(undefined, async () => {})).rejects.toThrow('fee changed')
      const get = s.intents.get.bind(s.intents)
      vi.spyOn(s.intents, 'get').mockImplementationOnce(async (scope, opId) => { const value = await get(scope, opId); if (invalidate === 'lock') s.controller.lock(); else s.session.invalidate(); return value })
      network.send.mockClear()
      await expect(prepareIdentitySetupRequest(s.options)).rejects.toThrow()
      expect((await get(s.scope, id))?.phase).toBe('not-sent'); expect(network.send).not.toHaveBeenCalled()
      s.controller.dispose()
    }
  })
  it('stores the two-call digest before wallet and confirms only the matched batch', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    network.send.mockImplementationOnce(async (messages, _memo, options) => {
      expect(messages).toEqual(request.prepare(undefined).msgs)
      expect(messages).toHaveLength(2)
      const intent = await s.intents.get(s.scope, op)
      expect(intent).toMatchObject({ phase: 'prepared', action: 'identity-setup', expectedStateRevision: '0', expectedEpoch: '0' })
      expect(intent?.requestDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(intent?.verification).toMatchObject({ kind: 'identity-v1', mode: 'standard', generation: '1', backupRevision: '1', quoteHeight: '10' })
      expect(Object.keys(intent!.verification!).sort()).toEqual(['backupRevision', 'backupSha256', 'generation', 'kind', 'mode', 'publicKeySha256', 'quoteHeight'])
      await options.beforeSign(); return { hash: 'aa'.repeat(32) }
    })
    await request.send(undefined, async () => () => true)
    expect((await s.intents.get(s.scope, op))?.phase).toBe('submitted')
    expect(await request.verify!(undefined, 'aa'.repeat(32), null)).toBe(false)
    s.apply('55'.repeat(16)); expect(await request.verify!(undefined, 'aa'.repeat(32), null)).toBe(false)
    expect(s.controller.confirmSetup).not.toHaveBeenCalled()
    s.apply(); expect(await request.verify!(undefined, 'aa'.repeat(32), null)).toBe(true)
    expect((await s.intents.get(s.scope, op))?.phase).toBe('confirmed')
  })
  it('does not open a wallet when the intent cannot be committed', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('storage')
    expect(network.send).not.toHaveBeenCalled()
  })
  it('rechecks central gating, captured session and the pending prepared identity', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options); s.disable()
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    const t = setup(), second = await prepareIdentitySetupRequest(t.options); t.session.invalidate()
    await expect(second.send(undefined, async () => {})).rejects.toThrow('session')
    const u = setup(), third = await prepareIdentitySetupRequest(u.options); u.controller.lock()
    await expect(third.send(undefined, async () => {})).rejects.toThrow('locked')
    expect(network.send).not.toHaveBeenCalled()
  })
  it('refuses an expired final guard and preserves ambiguous wallet outcomes', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    network.send.mockImplementationOnce(async (_messages, _memo, options) => {
      const guard = await options.beforeSign(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000)
      expect(guard()).toBe(false); throw new Error('rejected by wallet')
    })
    await expect(request.send(undefined, async () => () => true)).rejects.toThrow('rejected')
    request.onNothingSent?.()
    expect((await s.intents.get(s.scope, op))?.phase).toBe('unknown')
  })
  it('refuses a quote with an unbound batch or an excessive cap', async () => {
    const s = setup(), quote = s.options.quote
    await expect(prepareIdentitySetupRequest({ ...s.options, quote: async input => ({ ...await quote(input), requestDigest: 'aa'.repeat(32) }) })).rejects.toThrow()
    await expect(prepareIdentitySetupRequest({ ...s.options, quote: async input => ({ ...await quote(input), maxDepositUgnot: '2000001' }) })).rejects.toThrow()
    expect(network.send).not.toHaveBeenCalled()
  })
  it('recovers a saved batch after controller lock using public receipts only, and is idempotent', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    await request.send(undefined, async () => () => true)
    const intent = (await s.intents.get(s.scope, op))!
    await s.intents.settle(s.scope, op, 'unknown', s.session.capture())
    s.controller.lock(); s.apply(); network.send.mockClear()
    // New session + intent store instance models the reload, with no in-memory setup plan.
    const reloaded = createNotesIntents(s.store)
    expect(await recoverIdentityIntent(s.options.client, reloaded, intent, createDraftSession())).toBe('confirmed')
    expect((await reloaded.get(s.scope, op))?.phase).toBe('confirmed')
    expect(await recoverIdentityIntent(s.options.client, reloaded, intent, createDraftSession())).toBe('confirmed')
    expect(s.controller.confirmSetup).not.toHaveBeenCalled()
    expect(network.send).not.toHaveBeenCalled()
  })
  it.each(['missing-key', 'missing-backup', 'key-op', 'backup-op', 'generation', 'backup-revision', 'height', 'old-height', 'pk', 'backup', 'actor', 'mode'])(
    'keeps the durable receipt unknown on %s mismatch', async field => {
      const s = setup(), request = await prepareIdentitySetupRequest(s.options)
      await request.send(undefined, async () => () => true); s.apply(); s.controller.lock()
      const intent = (await s.intents.get(s.scope, op))!
      const client = s.options.client, key = await client.key(owner), raw = await client.seedBackupRaw(owner) as Record<string, unknown>
      switch (field) {
        case 'missing-key': key.active = false; key.publicKey = new Uint8Array(); break
        case 'key-op': key.operationId = '55'.repeat(16); break
        case 'generation': key.generation = '2'; break
        case 'pk': key.publicKey = key.publicKey.slice(); key.publicKey[0] ^= 1; break
        case 'backup-op': raw.op_id = '55'.repeat(16); break
        case 'backup-revision': raw.revision = '2'; break
        case 'height': raw.height = '12'; break
        case 'old-height': key.height = '10'; raw.height = '10'; break
        case 'backup': { const bytes = blob(raw.record, 365); bytes[bytes.length - 1] ^= 1; raw.record = encode64(bytes); break }
        case 'actor': raw.actor = bech32Encode('g', new Uint8Array(20).fill(2)); break
        case 'mode': raw.mode = 2; break
      }
      vi.mocked(client.key).mockResolvedValue(key)
      vi.mocked(client.seedBackupRaw).mockResolvedValue(field === 'missing-backup' ? null : raw)
      network.send.mockClear()
      expect(await recoverIdentityIntent(client, s.intents, intent, createDraftSession())).toBe('unknown')
      expect((await s.intents.get(s.scope, op))?.phase).toBe('submitted')
      expect(network.send).not.toHaveBeenCalled(); expect(s.controller.confirmSetup).not.toHaveBeenCalled()
    })
  it('fails closed on a changed session/network or missing legacy descriptor', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    await request.send(undefined, async () => () => true); s.apply()
    const intent = (await s.intents.get(s.scope, op))!, session = createDraftSession()
    vi.mocked(s.options.client.key).mockImplementationOnce(async () => { session.invalidate(); throw new Error('session changed') })
    expect(await recoverIdentityIntent(s.options.client, s.intents, intent, session)).toBe('unknown')
    expect(await recoverIdentityIntent({ ...s.options.client, chainId: 'other-chain' } as NotesReadClient, s.intents, intent, createDraftSession())).toBe('unknown')
    const legacy = { ...intent, operationId: '66'.repeat(16), verification: undefined, expectedStateRevision: '1', resultingStateRevision: '2', ownerGeneration: '1' }
    expect((await s.intents.begin(legacy, s.session.capture())).status).toBe('saved')
    expect(await recoverIdentityIntent(s.options.client, s.intents, legacy, createDraftSession())).toBe('unknown')
  })
  it('rejects secret/extra descriptor fields and inconsistent durable CAS before wallet', async () => {
    const s = setup(), request = await prepareIdentitySetupRequest(s.options)
    await request.send(undefined, async () => () => true)
    const intent = (await s.intents.get(s.scope, op))!
    expect(validIdentityVerification({ ...intent.verification, seed: 'private' })).toBe(false)
    expect(validIdentityVerification({ ...intent.verification, generation: '0' })).toBe(false)
    expect((await s.intents.begin({ ...intent, operationId: '77'.repeat(16), expectedEpoch: '2' }, s.session.capture())).status).toBe('invalid')
  })

})
