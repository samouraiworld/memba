import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore, notesKey, notesRead, notesWrite } from '../drafts'
import type { NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesIntentInput, PublicIntentVerification } from '../intents'
import { publicIntentEvidence, publicVerification, recoverPublicIntent } from './recovery'
import type { PublicNoteOperation } from './messages'
import { NOTES_REALM } from './schema'
import type { ChainNote } from './schema'

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = 'ab'.repeat(16), operationId = 'cd'.repeat(16)
const scope = { chainId: 'gnoland-1', realm: NOTES_REALM, owner, noteId }, bytes = (value: string) => new TextEncoder().encode(value)
const base = (): ChainNote => ({ id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '5', titleRevision: '2', bodyRevision: '3', epoch: '0', title: bytes('Title'), body: bytes('Old'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '90', operationId: '11'.repeat(16), actor: owner, height: '99' })
const operation: PublicNoteOperation = { caller: owner, noteId, operationId, action: { kind: 'commit', revision: '5', epoch: '0', body: 'Reviewed' } }
const applied = (patch: Partial<ChainNote> = {}): ChainNote => ({ ...base(), stateRevision: '6', bodyRevision: '4', body: bytes('Reviewed'), height: '101', operationId, ...patch })
const input = (): NotesIntentInput => ({ scope: { ...scope }, operationId, requestDigest: 'ef'.repeat(32), actor: owner, action: 'commit', expectedStateRevision: '5', resultingStateRevision: '6', expectedEpoch: '0', ownerGeneration: '1', draftLocalRevision: '1', verification: publicVerification(operation, base(), '100') })
const stores: NotesStore[] = []
function setup(factory = new IDBFactory()) {
  const store = createNotesStore({ indexedDB: factory }); stores.push(store)
  return { store, intents: createNotesIntents(store), session: createDraftSession(), client: { chainId: scope.chainId, assertCurrent: vi.fn(), note: vi.fn(async (): Promise<ChainNote | null> => applied()) } }
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())) })

describe('exact public intent recovery', () => {
  it('recovers after reload without consulting or clearing a changed draft, retaining the original hash', async () => {
    const factory = new IDBFactory(), first = setup(factory)
    await first.intents.begin(input(), first.session)
    await first.intents.settle(scope, operationId, 'submitted', first.session, 'aa'.repeat(32))
    await first.intents.settle(scope, operationId, 'unknown', first.session)
    await first.store.saveDraft(scope, '0', { kind: 'public', title: 'Changed', body: 'Newer local edits' }, first.session)
    await first.store.close()
    const next = setup(factory), receipt = (await next.intents.get(scope, operationId))!
    const reads = vi.spyOn(next.store, 'getDraft')
    expect(await recoverPublicIntent(next.client, next.intents, receipt, next.session)).toBe('confirmed')
    expect(reads).not.toHaveBeenCalled()
    expect((await next.store.getDraft(scope))?.payload).toMatchObject({ body: 'Newer local edits' })
    expect(await next.intents.get(scope, operationId)).toMatchObject({ phase: 'confirmed', txHash: 'AA'.repeat(32), verification: input().verification })
    expect(JSON.stringify(await next.intents.get(scope, operationId))).not.toContain('Reviewed')
  })

  it('retains unknown for overwritten receipts, stale heights, wrong bytes, modes, epochs and component revisions', async () => {
    const s = setup(); await s.intents.begin(input(), s.session); await s.intents.settle(scope, operationId, 'unknown', s.session, 'aa'.repeat(32))
    const intent = (await s.intents.get(scope, operationId))!
    for (const patch of [{ operationId: '22'.repeat(16) }, { height: '100' }, { stateRevision: '7' }, { ownerGeneration: '2' }, { titleRevision: '3' }, { bodyRevision: '5' }, { body: bytes('Other') }, { title: bytes('Other') }, { mode: 4 as const }, { epoch: '1' }, { actor: 'other' }, { deleted: true }]) {
      s.client.note.mockResolvedValue(applied(patch))
      expect(await recoverPublicIntent(s.client, s.intents, intent, s.session)).toBe('unknown')
    }
    s.client.note.mockResolvedValue(null)
    expect(await recoverPublicIntent(s.client, s.intents, intent, s.session)).toBe('unknown')
    expect(await s.intents.get(scope, operationId)).toMatchObject({ phase: 'unknown', txHash: 'AA'.repeat(32) })
  })

  it('requires the exact public tombstone for delete while preserving title/body revisions', async () => {
    const op: PublicNoteOperation = { ...operation, action: { kind: 'delete', revision: '5' } }
    const value = { ...input(), action: 'delete', verification: publicVerification(op, base(), '100') }
    const tombstone = applied({ deleted: true, listed: false, title: new Uint8Array(), body: new Uint8Array(), bodyRevision: '3' })
    expect(publicIntentEvidence(value, tombstone)).not.toBeNull()
    for (const patch of [{ listed: true }, { body: bytes('retained') }, { title: bytes('retained') }, { pendingOwner: owner }, { bodyRevision: '4' }, { deleted: false }]) expect(publicIntentEvidence(value, { ...tombstone, ...patch })).toBeNull()
    const s = setup(); await s.intents.begin(value, s.session); s.client.note.mockResolvedValue(tombstone)
    expect(await recoverPublicIntent(s.client, s.intents, (await s.intents.get(scope, operationId))!, s.session)).toBe('confirmed')
  })

  it('predicts creation, rename, partial commit and comment-mode component revisions', () => {
    const descriptor = (action: PublicNoteOperation['action']) => publicVerification({ ...operation, action }, action.kind === 'create' ? null : base(), '100')
    expect(descriptor({ kind: 'create', title: 'Title', body: '', mode: 4, maxFeeUgnot: '0' })).toMatchObject({ mode: 4, titleRevision: '1', bodyRevision: '1', epoch: '0' })
    expect(descriptor({ kind: 'rename', revision: '5', epoch: '0', title: 'New' })).toMatchObject({ titleRevision: '3', bodyRevision: '3' })
    expect(descriptor({ kind: 'commit', revision: '5', epoch: '0', title: 'New', body: '' })).toMatchObject({ titleRevision: '3', bodyRevision: '4' })
    expect(descriptor({ kind: 'comments', revision: '5', open: true })).toMatchObject({ mode: 4, titleRevision: '2', bodyRevision: '3' })
    expect(() => publicVerification(operation, { ...base(), mode: 1 }, '100')).toThrow()
  })

  it('snapshots descriptors before persistence and refuses malformed or non-public descriptors', async () => {
    const s = setup(), value = input(), original = structuredClone(value.verification)
    const pending = s.intents.begin(value, s.session)
    value.verification!.bodySha256 = '00'.repeat(32)
    expect((await pending).status).toBe('saved')
    expect((await s.intents.get(scope, operationId))?.verification).toEqual(original)
    for (const patch of [{ kind: 'encrypted-v1' }, { titleSha256: 'FF'.repeat(32) }, { bodySha256: 'bad' }, { quoteHeight: '0' }, { quoteHeight: '9223372036854775808' }, { epoch: '4294967296' }, { titleRevision: '0' }, { ownerGeneration: '2' }, { plaintext: 'forbidden' }]) {
      const bad = { ...input(), operationId: '22'.repeat(16), verification: { ...original, ...patch } as PublicIntentVerification }
      expect(await s.intents.begin(bad, s.session)).toEqual({ status: 'invalid' })
    }
    expect(await s.intents.begin({ ...input(), action: 'PublishIdentity' }, s.session)).toEqual({ status: 'invalid' })
  })

  it('fails closed on tampered stored descriptors and never upgrades a legacy receipt', async () => {
    const s = setup(); await s.intents.begin(input(), s.session)
    const receipt = (await s.intents.get(scope, operationId))!, key = JSON.stringify([notesKey(scope), operationId])
    const original = await notesRead<Record<string, unknown>>(s.store.database, 'intents', records => records.get(key))
    for (const verification of [{ ...input().verification, bodySha256: '00'.repeat(32) }, { ...input().verification, plaintext: 'extra' }, undefined]) {
      await notesWrite(s.store.database, ['intents'], s.session.signal, (tx, finish) => {
        tx.objectStore('intents').put({ ...original, verification }); finish({ status: 'saved', value: null })
      })
      expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('unknown')
      expect(await notesRead(s.store.database, 'intents', records => records.get(key))).toHaveProperty('phase', 'prepared')
    }
  })

  it('does not let caller mutation, a network error or a session change replace durable proof', async () => {
    const s = setup(); await s.intents.begin(input(), s.session)
    const receipt = (await s.intents.get(scope, operationId))!
    receipt.verification!.bodySha256 = '00'.repeat(32)
    s.client.note.mockRejectedValueOnce(new Error('offline'))
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('unknown')
    s.client.note.mockImplementationOnce(async () => { s.session.invalidate(); return applied() })
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('unknown')
    expect((await s.intents.get(scope, operationId))?.phase).toBe('prepared')
    expect(await recoverPublicIntent({ ...s.client, chainId: 'another-chain' }, s.intents, receipt, s.session)).toBe('unknown')
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('confirmed')
  })
  it('recovers explicit-writer receipts with the reviewed owner and never broadens legacy receipts', async () => {
    const writer = bech32Encode('g', new Uint8Array(20).fill(2)), s = setup()
    const value = { ...input(), actor: writer, scope: { ...scope, owner: writer }, verification: publicVerification({ ...operation, caller: writer }, base(), '100') }
    expect((await s.intents.begin(value, s.session)).status).toBe('saved')
    const receipt = (await s.intents.get(value.scope, operationId))!
    s.client.note.mockResolvedValue(applied({ actor: writer, owner: writer }))
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('unknown')
    s.client.note.mockResolvedValue(applied({ actor: writer }))
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('confirmed')
    const legacy = { ...value, verification: { ...value.verification } }
    delete legacy.verification.owner
    expect(publicIntentEvidence(legacy, applied({ actor: writer }))).toBeNull()
    const oldOwner = { ...input(), verification: { ...input().verification } as PublicIntentVerification }
    delete oldOwner.verification.owner
    expect(publicIntentEvidence(oldOwner, applied())).not.toBeNull()
    expect(publicIntentEvidence(value, applied({ actor: writer, ownerGeneration: '2' }))).toBeNull()
  })

})
