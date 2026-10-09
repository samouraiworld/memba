import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore } from '../drafts'
import type { NotesStore } from '../drafts'
import { createNotesIntents, validPublicVerification } from '../intents'
import type { NotesReadClient } from './client'
import { parsePublicCapabilities } from './capabilities'
import { publicNoteMessage, type PublicNoteOperation } from './messages'
import { recoverPublicIntent } from './recovery'
import { notesRequestDigest, preparePublicNoteRequest } from './request'
import type { NotesQuoteProvider, PublicRequestOptions } from './request'
import { NOTES_REALM } from './schema'
import type { ChainNote } from './schema'

const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn() }))
vi.mock('../../grc20', () => ({
  MAX_GAS_WANTED: 500_000_000,
  doContractBroadcast: (...args: unknown[]) => wallet.send(...args),
  freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args),
  assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') },
}))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '11'.repeat(16), operationId = '22'.repeat(16)
const bytes = (s: string) => new TextEncoder().encode(s)
const stores: NotesStore[] = []
const baseNote = (): ChainNote => ({ id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0', title: bytes('Title'), body: bytes('Old'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '90', operationId: '33'.repeat(16), actor: owner, height: '90' })
function setup() {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  let current: ChainNote | null = baseNote(), enabled = true, height = '100', publicWrites = false
  const client = { publicCapabilities: vi.fn(async () => current ? parsePublicCapabilities({ schema: 'memba-notes/public-capabilities/v1', id: current.id, state_revision: current.stateRevision, owner_generation: current.ownerGeneration, mode: current.mode, deleted: current.deleted, allow_public_writes: publicWrites }) : null), writersRaw: vi.fn(async () => []), noteMetadata: vi.fn(async () => structuredClone(current)), chainId: 'test-chain', assertCurrent: vi.fn(), note: vi.fn(async () => structuredClone(current)), height: vi.fn(async () => height), config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false })) } as unknown as NotesReadClient
  const operation: PublicNoteOperation = { caller: owner, noteId, operationId, action: { kind: 'commit', revision: '1', epoch: '0', body: 'New' } }
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: (BigInt(input.height) + 10n).toString(), expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '100', maxDepositUgnot: '1000', gasWanted: 100000, networkFeeUgnot: 1000 })
  const options: PublicRequestOptions = { client, operation, maxDepositUgnot: '1000', draftLocalRevision: '5', session, intents, quote, isWriteEnabled: () => enabled }
  const scope = { chainId: client.chainId, realm: NOTES_REALM, owner, noteId }
  const applied = (patch: Partial<ChainNote> = {}) => { current = { ...baseNote(), operationId, stateRevision: '2', bodyRevision: '2', body: bytes('New'), height: '101', ...patch } }
  return { options, store, intents, session, scope, applied, setPublicWrites: (value: boolean) => { publicWrites = value }, setNote: (note: ChainNote | null) => { current = note }, disable: () => { enabled = false }, setHeight: (value: string) => { height = value } }
}
beforeEach(() => {
  vi.clearAllMocks(); wallet.fee.mockResolvedValue(900)
  wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('Notes signing intentions', () => {
  it.each([true, false])('reviews explicit collective writing=%s and confirms its exact capability', async enabled => {
    const s = setup(); s.setNote({ ...baseNote(), mode: 4 }); s.setPublicWrites(!enabled)
    s.options.operation.action = { kind: 'public-writes', revision: '1', enabled }
    const request = await preparePublicNoteRequest(s.options)
    expect(request.title).toBe(enabled ? 'Allow everyone to edit' : 'Stop public editing')
    expect(request.label!(undefined)).toBe(request.title)
    expect(request.prepare(undefined).msgs[0].value).toMatchObject({ func: 'SetPublicWrites', send: '', args: [expect.any(String), '1', String(enabled), expect.any(String)] })
    await request.send(undefined, async () => () => true)
    s.applied({ mode: 4, bodyRevision: '1', body: bytes('Old') })
    expect(await request.verify!(undefined, undefined, undefined)).toBe(false)
    s.setPublicWrites(enabled)
    expect(await request.verify!(undefined, undefined, undefined)).toBe(true)
    const receipt = (await s.intents.get(s.scope, operationId))!
    expect(receipt.phase).toBe('confirmed'); expect(receipt.verification).toMatchObject({ kind: 'public-v1', owner, allowPublicWrites: enabled })
    expect(validPublicVerification({ ...receipt.verification, allowPublicWrites: 'true' })).toBe(false)
    expect(validPublicVerification({ ...receipt.verification, mode: 3 })).toBe(false)
  })
  it.each(['nonowner', 'restricted', 'missing', 'noop', 'changed'])('refuses unsafe collective toggle: %s', async reason => {
    const s = setup(); s.setNote({ ...baseNote(), mode: reason === 'restricted' ? 3 : 4 })
    s.options.operation.action = { kind: 'public-writes', revision: '1', enabled: true }
    if (reason === 'nonowner') s.options.operation.caller = bech32Encode('g', new Uint8Array(20).fill(2))
    if (reason === 'missing') vi.spyOn(s.options.client, 'publicCapabilities').mockResolvedValue(null)
    if (reason === 'noop') s.setPublicWrites(true)
    if (reason === 'changed') {
      const request = await preparePublicNoteRequest(s.options)
      s.setNote({ ...baseNote(), mode: 4, stateRevision: '2' })
      await expect(request.recheck!()).rejects.toThrow('stale')
    } else await expect(preparePublicNoteRequest(s.options)).rejects.toThrow('stale')
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('recovers a collective toggle only with a matching durable target and same-revision capability', async () => {
    const s = setup(); s.setNote({ ...baseNote(), mode: 4 })
    s.options.operation.action = { kind: 'public-writes', revision: '1', enabled: true }
    const request = await preparePublicNoteRequest(s.options); await request.send(undefined, async () => () => true)
    await s.intents.settle(s.scope, operationId, 'unknown', s.session)
    const receipt = (await s.intents.get(s.scope, operationId))!
    s.applied({ mode: 4, bodyRevision: '1', body: bytes('Old') }); s.setPublicWrites(true)
    const getter = s.options.client.publicCapabilities.bind(s.options.client)
    vi.spyOn(s.options.client, 'publicCapabilities').mockResolvedValueOnce({ ...(await getter(noteId))!, stateRevision: '3' })
    expect(await recoverPublicIntent(s.options.client, s.intents, receipt, s.session)).toBe('unknown')
    expect(await recoverPublicIntent(s.options.client, s.intents, receipt, s.session)).toBe('confirmed')
    expect(wallet.send).toHaveBeenCalledOnce()
    expect((await s.intents.begin({ ...receipt, action: 'comments' }, s.session)).status).toBe('invalid')
    expect(() => publicNoteMessage({ ...s.options.operation, action: { kind: 'public-writes', revision: '1', enabled: 'true' as unknown as boolean } }, '100')).toThrow()
  })

  it('persists before wallet and signs exact reviewed calls without modifying the draft', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    expect(await s.intents.list(s.scope)).toEqual([])
    await s.store.saveDraft(s.scope, '0', { kind: 'public', title: 'Title', body: 'New' }, s.session)
    wallet.send.mockImplementationOnce(async (messages, _memo, options) => {
      expect((await s.intents.get(s.scope, operationId))?.phase).toBe('prepared')
      expect((await s.intents.get(s.scope, operationId))?.requestDigest).toBe(notesRequestDigest(s.options.client.chainId, messages[0]))
      expect(messages).toEqual(request.prepare(undefined).msgs)
      await options.beforeSign(); return { hash: 'aa'.repeat(32) }
    })
    await request.send(undefined, async () => () => true)
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
    s.applied(); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('confirmed')
    expect((await s.store.getDraft(s.scope))?.payload.kind).toBe('public')
    await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
  })
  it('rejects a quote that expires while the broadcaster waits after beforeSign', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => {
      const guard = await options.beforeSign()
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000)
      expect(guard()).toBe(false)
      throw new Error('final guard refused')
    })
    await expect(request.send(undefined, async () => () => true)).rejects.toThrow('final guard')
  })
  it('refuses storage failures before invoking the broadcaster', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('storage')
    expect(wallet.send).not.toHaveBeenCalled(); expect(await s.intents.list(s.scope)).toEqual([])
  })
  it('fails closed on the central flag and captured account session', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options); s.disable()
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    const t = setup(), second = await preparePublicNoteRequest(t.options); t.session.invalidate()
    await expect(second.send(undefined, async () => {})).rejects.toThrow('session')
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('retains unknown after wallet cancellation, including a driver cancellation callback', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('rejected by user') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('rejected')
    request.onNothingSent?.()
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
    const duplicate = await preparePublicNoteRequest({ ...s.options, operation: { ...s.options.operation, operationId: '44'.repeat(16) } })
    await expect(duplicate.send(undefined, async () => {})).rejects.toThrow('stale')
  })
  it('marks pre-wallet refusals not-sent, preserving their receipt', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    wallet.fee.mockResolvedValueOnce(1001)
    await expect(request.send(undefined, async () => {})).rejects.toThrow('fee changed')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('not-sent')
  })
  it('checks quote digest, bounded expiry and storage/gas limits', async () => {
    for (const patch of [{ requestDigest: 'wrong' }, { estimatedDepositUgnot: '1001' }, { gasWanted: 500000001 }, { expiresAtHeight: '200' }, { expiresAtMs: 0 }]) {
      const s = setup(), quote = s.options.quote
      await expect(preparePublicNoteRequest({ ...s.options, quote: async input => ({ ...await quote(input), ...patch }) })).rejects.toThrow()
    }
    expect(notesRequestDigest('a', { type: 'x', value: {} })).not.toBe(notesRequestDigest('b', { type: 'x', value: {} }))
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('refuses changes to owner generation, epoch, revision, fee or quote height before signing', async () => {
    for (const patch of [{ ownerGeneration: '2' }, { epoch: '1' }, { stateRevision: '2' }]) {
      const s = setup(), request = await preparePublicNoteRequest(s.options); s.setNote({ ...baseNote(), ...patch })
      // Generation 2 at state revision 1 is impossible and the strict C1 codec rejects it first.
      await expect(request.recheck!(undefined)).rejects.toThrow('ownerGeneration' in patch ? 'format' : 'stale')
    }
    const s = setup(), request = await preparePublicNoteRequest(s.options); s.setHeight('111')
    await expect(request.recheck!(undefined)).rejects.toThrow('stale')
  })
  it('does not confirm a reused old ID, wrong content, overwritten receipt or unrelated actor', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    await request.send(undefined, async () => {})
    for (const patch of [{ height: '100' }, { body: bytes('Wrong') }, { operationId: '44'.repeat(16) }, { stateRevision: '3' }, { actor: bech32Encode('g', new Uint8Array(20).fill(2)) }]) {
      s.applied(patch); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    }
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
  })
  it.each(['commit', 'rename'] as const)('lets an explicit Public writer %s while retaining note ownership', async kind => {
    const s = setup(), writer = bech32Encode('g', new Uint8Array(20).fill(2))
    vi.mocked(s.options.client.writersRaw).mockResolvedValue([writer])
    s.options.operation = { ...s.options.operation, caller: writer, action: kind === 'commit'
      ? { kind, revision: '1', epoch: '0', body: 'New' } : { kind, revision: '1', epoch: '0', title: 'New title' } }
    const request = await preparePublicNoteRequest(s.options)
    await request.send(undefined, async () => () => true)
    const scope = { ...s.scope, owner: writer }, intent = await s.intents.get(scope, operationId)
    expect(intent).toMatchObject({ actor: writer, verification: { owner } })
    const result = kind === 'commit' ? { actor: writer } : { actor: writer, title: bytes('New title'), titleRevision: '2', bodyRevision: '1', body: bytes('Old') }
    s.applied({ ...result, owner: writer }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.applied(result); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    expect((await s.intents.get(scope, operationId))?.phase).toBe('confirmed')
  })
  it('does not infer public writer rights from membership, PublicOpen, or writer presence for owner-only operations', async () => {
    const writer = bech32Encode('g', new Uint8Array(20).fill(2))
    for (const action of [{ kind: 'delete', revision: '1' }, { kind: 'comments', revision: '1', open: true }] as PublicNoteOperation['action'][]) {
      const s = setup(); vi.mocked(s.options.client.writersRaw).mockResolvedValue([writer])
      await expect(preparePublicNoteRequest({ ...s.options, operation: { ...s.options.operation, caller: writer, action } })).rejects.toThrow('stale')
    }
    for (const note of [{ ...baseNote(), mode: 4 as const }, { ...baseNote(), govWriters: true }]) {
      const s = setup(); s.setNote(note)
      vi.mocked(s.options.client.writersRaw).mockResolvedValue(note.mode === 4 ? [writer] : [])
      await expect(preparePublicNoteRequest({ ...s.options, operation: { ...s.options.operation, caller: writer } })).rejects.toThrow('stale')
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('rechecks the explicit ACL before wallet and refuses mixed-revision permission reads', async () => {
    const writer = bech32Encode('g', new Uint8Array(20).fill(2)), s = setup()
    s.options.operation = { ...s.options.operation, caller: writer }
    vi.mocked(s.options.client.writersRaw).mockResolvedValue([writer])
    const request = await preparePublicNoteRequest(s.options)
    vi.mocked(s.options.client.writersRaw).mockResolvedValue([])
    await expect(request.recheck!(undefined)).rejects.toThrow('stale')
    vi.mocked(s.options.client.writersRaw).mockResolvedValue([writer])
    vi.mocked(s.options.client.noteMetadata).mockResolvedValue({ ...baseNote(), stateRevision: '2' })
    await expect(preparePublicNoteRequest(s.options)).rejects.toThrow('stale')
    expect(wallet.send).not.toHaveBeenCalled()
  })

  it.each(['commit', 'rename'] as const)('prepares and sends community %s only for the bound Sushi opt-in', async kind => {
    const s = setup(), caller = bech32Encode('g', new Uint8Array(20).fill(2))
    s.setNote({ ...baseNote(), mode: 4 }); s.setPublicWrites(true)
    s.options.operation = { ...s.options.operation, caller, action: kind === 'commit'
      ? { kind, revision: '1', epoch: '0', body: 'New' } : { kind, revision: '1', epoch: '0', title: 'New title' } }
    const request = await preparePublicNoteRequest(s.options), beforeWallet = vi.fn(async () => () => true)
    expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller, func: kind === 'commit' ? 'Commit' : 'Rename' })
    await request.send(undefined, beforeWallet)
    expect(beforeWallet).toHaveBeenCalledOnce()
    expect(s.options.client.publicCapabilities).toHaveBeenCalledTimes(2)
    expect(await s.intents.get({ ...s.scope, owner: caller }, operationId)).toMatchObject({ phase: 'submitted', verification: { owner } })
  })
  it.each(['commit', 'rename'] as const)('refuses revoked community %s between review and wallet without widening management', async kind => {
    const s = setup(), caller = bech32Encode('g', new Uint8Array(20).fill(2))
    s.setNote({ ...baseNote(), mode: 4 }); s.setPublicWrites(true)
    s.options.operation = { ...s.options.operation, caller, action: kind === 'commit'
      ? { kind, revision: '1', epoch: '0', body: 'New' } : { kind, revision: '1', epoch: '0', title: 'New title' } }
    const request = await preparePublicNoteRequest(s.options), beforeWallet = vi.fn(async () => () => true)
    s.setPublicWrites(false); s.setNote({ ...baseNote(), mode: 4, stateRevision: '2' })
    await expect(request.send(undefined, beforeWallet)).rejects.toThrow('stale')
    expect(beforeWallet).not.toHaveBeenCalled()
    expect(await s.intents.get({ ...s.scope, owner: caller }, operationId)).toMatchObject({ phase: 'not-sent' })
    s.setNote({ ...baseNote(), mode: 4 }); s.setPublicWrites(true)
    for (const action of [{ kind: 'delete', revision: '1' }, { kind: 'comments', revision: '1', open: false }] as const) {
      await expect(preparePublicNoteRequest({ ...s.options, operation: { ...s.options.operation, action } })).rejects.toThrow('stale')
    }
  })
  it('refuses null or revoked capabilities before signing even if a stale endpoint repeats the note revision', async () => {
    for (const missing of [false, true]) {
      const s = setup(), caller = bech32Encode('g', new Uint8Array(20).fill(2))
      s.setNote({ ...baseNote(), mode: 4 }); s.setPublicWrites(true); s.options.operation.caller = caller
      const request = await preparePublicNoteRequest(s.options), beforeWallet = vi.fn(async () => {})
      if (missing) vi.mocked(s.options.client.publicCapabilities).mockResolvedValue(null)
      else s.setPublicWrites(false)
      await expect(request.send(undefined, beforeWallet)).rejects.toThrow('stale')
      expect(beforeWallet).not.toHaveBeenCalled()
    }
  })
  it('invalidates a captured request session while capability reading is pending', async () => {
    const s = setup(), read = vi.mocked(s.options.client.publicCapabilities).getMockImplementation()!
    vi.mocked(s.options.client.publicCapabilities).mockImplementationOnce(async id => {
      const result = await read(id); s.session.invalidate(); return result
    })
    const quote = vi.fn(s.options.quote)
    await expect(preparePublicNoteRequest({ ...s.options, quote })).rejects.toThrow('session')
    expect(quote).not.toHaveBeenCalled(); expect(wallet.send).not.toHaveBeenCalled()
  })

})
