/** Production adapter → OS Signer → broadcaster; only external services are fixtures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { executeSignature } from '../../../os/sign/signer'
import { GNO_CHAIN_ID } from '../../config'
import { clearRpcChainChecks } from '../../dao/chainIdentity'
import { bech32Encode } from '../../dao/realmAddress'
import { __resetGasPriceCache, setTxConfirmationCallback, setWalletActionGuard, setWalletRpcContext, toAdenaMessages } from '../../grc20'
import { liveWallet, STUB_WALLET_RPC } from '../../../test/walletStub'
import { createDraftSession, createNotesStore } from '../drafts'
import type { NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import type { NotesReadClient } from './client'
import { notesRequestDigest, preparePublicNoteRequest } from './request'
import type { PublicRequestOptions } from './request'
import { NOTES_REALM } from './schema'
import type { ChainNote } from './schema'

vi.mock('@sentry/react', async original => ({ ...await original<typeof import('@sentry/react')>(), captureException: vi.fn() }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const noteId = '11'.repeat(16), operationId = '22'.repeat(16), txHash = 'aa'.repeat(32)
const bytes = (value: string) => new TextEncoder().encode(value)
const stores: NotesStore[] = []
const baseNote = (): ChainNote => ({ id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '0', title: bytes('Title'), body: bytes('Old'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '90', operationId: '33'.repeat(16), actor: owner, height: '90' })
function setup() {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  let current = baseNote()
  const client = { chainId: GNO_CHAIN_ID, assertCurrent: vi.fn(), note: vi.fn(async () => structuredClone(current)), height: vi.fn(async () => '100'), config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false })) } as unknown as NotesReadClient
  const options: PublicRequestOptions = {
    client, session, intents, isWriteEnabled: () => true, maxDepositUgnot: '1000', draftLocalRevision: '1',
    operation: { caller: owner, noteId, operationId, action: { kind: 'commit', revision: '1', epoch: '0', body: 'New' } },
    quote: async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '110', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '100', maxDepositUgnot: '1000', gasWanted: 100000, networkFeeUgnot: 1000 }),
  }
  const scope = { chainId: GNO_CHAIN_ID, realm: NOTES_REALM, owner, noteId }
  const wallet = { ...liveWallet({ address: owner }), DoContract: vi.fn(async () => ({ status: 'success', data: { hash: txHash } })) }
  Object.assign(window, { adena: wallet })
  return { options, store, session, intents, scope, wallet, applied: (patch: Partial<ChainNote> = {}) => { current = { ...baseNote(), operationId, stateRevision: '2', bodyRevision: '2', body: bytes('New'), height: '101', ...patch } } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  clearRpcChainChecks(); __resetGasPriceCache(); localStorage.clear()
  setWalletRpcContext(STUB_WALLET_RPC, true, GNO_CHAIN_ID, owner)
  setTxConfirmationCallback(null); setWalletActionGuard(null)
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input).pathname
    if (path !== '/status' && path !== '/abci_query') throw new Error('Unexpected fixture transport')
    const result = path === '/status' ? { node_info: { network: GNO_CHAIN_ID } }
      : { response: { ResponseBase: { Data: btoa(JSON.stringify({ gas: '1000', price: '1ugnot' })), Error: null } } }
    return new Response(JSON.stringify({ result }), { status: 200 })
  }))
})
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'adena')
  setWalletRpcContext(null, false, null); setTxConfirmationCallback(null); setWalletActionGuard(null)
  await Promise.all(stores.splice(0).map(store => store.close()))
})

describe('composed Notes signing', () => {
  it('commits before wallet access, broadcasts reviewed bytes, and confirms only the exact receipt', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options), reviewed = request.prepare(undefined).msgs
    await s.store.saveDraft(s.scope, '0', { kind: 'public', title: 'Title', body: 'New' }, s.session)
    const readAccount = s.wallet.GetAccount.getMockImplementation()!
    s.wallet.GetAccount.mockImplementation(async () => {
      expect(await s.intents.get(s.scope, operationId)).toMatchObject({ phase: 'prepared', requestDigest: notesRequestDigest(GNO_CHAIN_ID, reviewed[0]) })
      return readAccount()
    })
    const onWallet = vi.fn()
    const result = await executeSignature(request, undefined, reviewed, onWallet)
    expect(result).toMatchObject({ outcome: 'sent', hash: txHash }); expect(onWallet).toHaveBeenCalledOnce()
    expect(s.wallet.DoContract).toHaveBeenCalledExactlyOnceWith({ messages: toAdenaMessages(reviewed), gasFee: 1000, gasWanted: 100000, memo: '' }, { withNotification: true, isVisibleResult: false })
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
    for (const patch of [{ operationId: '44'.repeat(16) }, { actor: other }, { ownerGeneration: '2' }, { epoch: '1' }, { deleted: true }, { stateRevision: '3' }, { body: bytes('Wrong') }, { height: '100' }]) {
      s.applied(patch); expect(await request.verify!(undefined, txHash, undefined)).toBe(false)
    }
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('submitted')
    s.applied(); expect(await request.verify!(undefined, txHash, undefined)).toBe(true)
    expect(await s.intents.get(s.scope, operationId)).toMatchObject({ phase: 'confirmed', txHash: txHash.toUpperCase(), operationId, expectedStateRevision: '1', resultingStateRevision: '2' })
    expect((await s.store.getDraft(s.scope))?.payload).toEqual({ kind: 'public', title: 'Title', body: 'New' })
  })

  it('never reads the wallet when the durable intention cannot be committed', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
    const result = await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())
    expect(result.outcome).toBe('failed'); expect(s.wallet.GetAccount).not.toHaveBeenCalled(); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    expect(await s.intents.list(s.scope)).toEqual([])
  })

  it('refuses a quote expiring during the final Adena unlock after all asynchronous rechecks', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options), unlock = deferred<{ status: string }>(), onWallet = vi.fn()
    const account = s.wallet.GetAccount.getMockImplementation()!
    let reads = 0
    // Only the last live read locks, after onWallet; the first finishes before rechecks.
    s.wallet.GetAccount.mockImplementation(async () => ++reads === 2 ? { status: 'failure', type: 'WALLET_LOCKED' } as Awaited<ReturnType<typeof account>> : account())
    const AddEstablish = vi.fn(() => unlock.promise)
    Object.assign(s.wallet, { AddEstablish })
    const signing = executeSignature(request, undefined, request.prepare(undefined).msgs, onWallet)
    await vi.waitFor(() => expect(AddEstablish).toHaveBeenCalledOnce())
    expect(onWallet).toHaveBeenCalledOnce(); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000)
    unlock.resolve({ status: 'success' })
    expect((await signing).outcome).toBe('failed'); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    // Conservatively retain the lock even though the broadcaster stopped before DoContract.
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
  })

  it('refuses a live wallet account change without a cached account-change event', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    s.wallet.GetAccount.mockResolvedValue({ status: 'success', data: { address: other, chainId: GNO_CHAIN_ID } })
    const result = await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())
    expect(result.outcome).toBe('failed'); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    expect(await s.intents.get(s.scope, operationId)).not.toBeNull()
  })

  it('blocks an invalidated session at the final wallet boundary and preserves its prepared lock', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    const result = await executeSignature(request, undefined, request.prepare(undefined).msgs, () => s.session.invalidate())
    expect(result.outcome).toBe('unknown'); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('prepared')
  })

  it('keeps an uncertain wallet outcome durable and forbids automatic or same-revision retry', async () => {
    const s = setup(), request = await preparePublicNoteRequest(s.options)
    s.wallet.DoContract.mockRejectedValueOnce(new Error('rejected by user'))
    const result = await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())
    expect(result.outcome).toBe('unknown'); request.onSettled?.('unknown', undefined)
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
    const duplicate = await preparePublicNoteRequest({ ...s.options, operation: { ...s.options.operation, operationId: '44'.repeat(16) } })
    expect((await executeSignature(duplicate, undefined, duplicate.prepare(undefined).msgs, vi.fn())).outcome).toBe('failed')
    expect((await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())).outcome).toBe('failed')
    expect(s.wallet.DoContract).toHaveBeenCalledOnce()
    expect((await s.intents.list(s.scope)).map(intent => intent.phase)).toEqual(['unknown'])
  })
})
