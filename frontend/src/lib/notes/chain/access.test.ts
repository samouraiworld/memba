import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesReadClient } from './client'
import { encode64, type ChainNote } from './schema'
import { hexToBytes } from '@noble/hashes/utils.js'
import { NOTES_REALM } from './__fixtures__/deployment'
import type { NotesQuoteProvider } from './request'
import { accessMessage, type AccessOperation } from './accessMessages'
import { accessBudget, accessQuote } from './accessQuote'
import { prepareAccessRequest, recoverAccessIntent, type AccessRequestOptions } from './accessRequest'
import { recoverPrivateIntent } from '../privateNotes'

// PR D2b: deleting a private note (owner only), ported from the reviewed 10-09 access path, Delete only.
const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn(), price: vi.fn() }))
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: (...args: unknown[]) => wallet.fee(...args), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: (...args: unknown[]) => wallet.price(...args) }))
vi.mock('../config', async original => ({
  ...await original<typeof import('../config')>(),
  deploymentRealm: () => 'gno.land/r/samcrew/memba_notes_v1',
  privateNotesDeployment: (chainId: string) => gate.open && chainId === 'test-chain' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null,
}))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2)), noteId = '11'.repeat(16), operationId = '44'.repeat(16)
const stores: NotesStore[] = []
function setup(patch: Partial<ChainNote> = {}) {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  let note: ChainNote = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 0, stateRevision: '3', titleRevision: '2', bodyRevision: '3', epoch: '1', title: new Uint8Array(99).fill(7), bodyBytes: 1143,
    commitment: new Uint8Array(32).fill(9), deleted: false, listed: false, ownerListed: false, moderatorHidden: false, govWriters: false, createdHeight: '50', operationId: '22'.repeat(16), actor: owner, height: '90', ...patch }
  const client = { chainId: 'test-chain', realm: NOTES_REALM, assertCurrent: vi.fn(), noteMetadata: vi.fn(async () => note), writersRaw: vi.fn(async () => []), height: vi.fn(async () => '100') } as unknown as NotesReadClient
  const quote: NotesQuoteProvider = async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '110', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '0', maxDepositUgnot: '100000', gasWanted: 100_000_000, networkFeeUgnot: 120_000 })
  const operation: AccessOperation = { caller: owner, noteId, operationId, revision: '3', ownerGeneration: '1', action: { kind: 'delete' } }
  const options: AccessRequestOptions = { client, operation, maxDepositUgnot: '100000', session, intents, quote, isWriteEnabled: () => true }
  /** The note as the realm leaves it (notes.gno mutateDelete). */
  const deleted = (extra: Partial<ChainNote> = {}) => { note = { ...note, stateRevision: '4', deleted: true, listed: false, ownerListed: false, title: new Uint8Array(), bodyBytes: 0, commitment: new Uint8Array(), pendingOwner: '', govWriters: false, operationId, actor: owner, height: '101', ...extra } }
  return { client, store, intents, session, options, deleted, scope: { chainId: 'test-chain', realm: NOTES_REALM, owner, noteId } }
}
beforeEach(() => {
  vi.clearAllMocks(); gate.open = true; wallet.fee.mockResolvedValue(120_000); wallet.price.mockResolvedValue('"100ugnot"')
  wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
})
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())) })

describe('private Delete quote (M0 rows 8: every Delete refunds; 24.1-26.5 M gas, 72.7 M at 32 readers)', () => {
  it('quotes a refund, not a deposit: estimate 0, the smallest cap, 100 M gas', () => {
    const message = accessMessage(setup().options.operation, NOTES_REALM, '100000')
    expect(message.value).toEqual({ caller: owner, send: '', pkg_path: NOTES_REALM, func: 'Delete', args: [encode64(hexToBytes(noteId)), '3', encode64(hexToBytes(operationId))], max_deposit: '100000ugnot' })
    const budget = accessBudget(message)
    expect(budget).toEqual({ gasWanted: 100_000_000, estimatedDepositUgnot: '0', suggestedCapUgnot: '100000' })
    for (const gas of [24_100_000, 26_500_000, 72_660_000]) expect(budget.gasWanted).toBeGreaterThanOrEqual(gas * 1.37)
  })
  it('refuses another function or realm, and quotes only at 100 ugnot per byte', async () => {
    const message = accessMessage(setup().options.operation, NOTES_REALM, '100000')
    expect(() => accessBudget({ ...message, value: { ...message.value, func: 'Commit' } })).toThrow()
    expect(() => accessBudget({ ...message, value: { ...message.value, pkg_path: 'gno.land/r/samcrew/enckeys_v1' } })).toThrow()
    const s = setup(), input = { chainId: 'test-chain', message, requestDigest: 'aa'.repeat(32), height: '100' }
    expect(await accessQuote(s.client, '100000')(input)).toMatchObject({ estimatedDepositUgnot: '0', maxDepositUgnot: '100000', gasWanted: 100_000_000 })
    wallet.price.mockResolvedValueOnce('"101ugnot"'); await expect(accessQuote(s.client, '100000')(input)).rejects.toThrow()
  })
})

describe('private Delete signing flow', () => {
  it('records the exact expected deletion before the wallet, confirms only that deletion, and says the refund honestly', async () => {
    const s = setup(), request = await prepareAccessRequest(s.options)
    expect(request.warns).toContain('Delete returns about half of what this note locked; the rest stays locked.')
    expect(request.lines(undefined)).toContainEqual(['Storage deposit', 'None taken: deleting returns about half of what this note locked'])
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { expect((await s.intents.get(s.scope, operationId))?.phase).toBe('prepared'); await options.beforeSign(); return { hash: 'aa'.repeat(32) } })
    await request.send(undefined, async () => {})
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
    expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.deleted({ operationId: '55'.repeat(16) }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.deleted({ listed: true }); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(false)
    s.deleted(); expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('confirmed')
  })
  it('refuses another owner, a public note, a stale revision and a deleted note before anything is recorded', async () => {
    for (const patch of [{ owner: other }, { mode: 3 as const }, { stateRevision: '4' }, { ownerGeneration: '2' }, { deleted: true }]) {
      const s = setup(patch)
      await expect(prepareAccessRequest(s.options)).rejects.toThrow()
      expect(await s.intents.list(s.scope)).toEqual([])
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('refuses before the wallet when the private-notes gate closes, at every step', async () => {
    gate.open = false
    await expect(prepareAccessRequest(setup().options)).rejects.toThrow('disabled')
    gate.open = true
    const s = setup(), request = await prepareAccessRequest(s.options)
    gate.open = false
    await expect(request.send(undefined, async () => {})).rejects.toThrow('disabled')
    expect(() => request.prepare(undefined)).toThrow('disabled'); expect(await s.intents.list(s.scope)).toEqual([])
    gate.open = true
    const t = setup(), late = await prepareAccessRequest(t.options), opened = vi.fn()
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); opened(); return { hash: 'aa'.repeat(32) } })
    await expect(late.send(undefined, async () => { gate.open = false })).rejects.toThrow('disabled')
    expect(opened).not.toHaveBeenCalled(); expect((await t.intents.get(t.scope, operationId))?.phase).toBe('not-sent')
    gate.open = true
    const u = setup(), open = await prepareAccessRequest(u.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { const guard = await options.beforeSign(); gate.open = false; expect(guard()).toBe(false); throw new Error('refused') })
    await expect(open.send(undefined, async () => () => true)).rejects.toThrow('refused')
  })
  it('a note changed after the review is refused at the wallet step; a dismissed review records nothing', async () => {
    const s = setup(), request = await prepareAccessRequest(s.options)
    vi.mocked(s.client.noteMetadata).mockResolvedValue({ ...(await s.client.noteMetadata(noteId))!, stateRevision: '4' })
    await expect(request.send(undefined, async () => {})).rejects.toThrow()
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('not-sent')
    const t = setup(), dismissed = await prepareAccessRequest(t.options)
    dismissed.onDismissed?.(); await expect(dismissed.send(undefined, async () => {})).rejects.toThrow('session')
    expect(await t.intents.list(t.scope)).toEqual([])
  })
  it('recovers an unknown deletion from the chain alone, never resending it', async () => {
    const s = setup(), request = await prepareAccessRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('transport lost') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('transport lost')
    const intent = (await s.intents.get(s.scope, operationId))!
    expect(intent.phase).toBe('unknown')
    expect(await recoverAccessIntent(s.client, s.intents, intent, s.session)).toBe('unknown')
    s.deleted(); expect(await recoverAccessIntent(s.client, s.intents, intent, s.session)).toBe('confirmed')
    expect(wallet.send).toHaveBeenCalledOnce()
  })
  it('a deletion confirmed later by "Check outcome" also removes the encrypted draft, unless it changed after the deletion was prepared', async () => {
    for (const changedLater of [false, true]) {
      const s = setup(), envelope = new Uint8Array(1400).fill(3)
      expect((await s.store.saveDraft(s.scope, '0', { kind: 'encrypted', envelope }, createDraftSession())).status).toBe('saved')
      const request = await prepareAccessRequest(s.options)
      wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('transport lost') })
      await expect(request.send(undefined, async () => {})).rejects.toThrow('transport lost')
      const intent = (await s.intents.get(s.scope, operationId))!
      if (changedLater) { await new Promise(resolve => setTimeout(resolve, 5)); expect((await s.store.saveDraft(s.scope, '1', { kind: 'encrypted', envelope }, createDraftSession())).status).toBe('saved') }
      s.deleted()
      expect(await recoverPrivateIntent(s.client, s.intents, intent, s.session, s.store)).toBe('confirmed')
      expect(await s.store.getDraft(s.scope)).toEqual(changedLater ? expect.objectContaining({ localRevision: '2' }) : null)
    }
  })
})
