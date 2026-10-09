/** Real Notes request + OS Signer + broadcaster. Only external wallet/RPC/chain/storage are fixtures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { executeSignature } from '../../../os/sign/signer'
import { liveWallet, STUB_WALLET_RPC } from '../../../test/walletStub'
import { GNO_CHAIN_ID } from '../../config'
import { clearRpcChainChecks } from '../../dao/chainIdentity'
import { bech32Encode } from '../../dao/realmAddress'
import { __resetGasPriceCache, setWalletRpcContext, setTxConfirmationCallback, setWalletActionGuard, toAdenaMessages } from '../../grc20'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import { preparePublicCommentRequest, commentIntentRealm, type CommentRequestOptions } from './commentRequest'
import { encode64, NOTES_REALM, type ChainNote } from './schema'

vi.mock('@sentry/react', async original => ({ ...await original<typeof import('@sentry/react')>(), captureException: vi.fn() }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = '11'.repeat(16), commentId = '22'.repeat(16), operationId = '33'.repeat(16), txHash = 'aa'.repeat(32)
const bytes = (text: string) => new TextEncoder().encode(text), b64 = (text: string) => encode64(bytes(text)), stores: NotesStore[] = []
const applied = () => ({ id: commentId, parent: '0'.repeat(32), author: owner, encrypted: false, body_revision: '2', epoch: '0', revision: '1', anchor_blob: b64('Quoted'), body_blob: b64('Reply'), created_height: '101', op_id: operationId, actor: owner, height: '101', deleted: false, hidden: false, resolved: false })
function setup() {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  let comment: ReturnType<typeof applied> | null = null
  const note: ChainNote = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '2', titleRevision: '1', bodyRevision: '2', epoch: '0', title: bytes('Title'), body: bytes('Body'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '90', operationId: '44'.repeat(16), actor: owner, height: '99' }
  const client = { chainId: GNO_CHAIN_ID, assertCurrent: vi.fn(), note: vi.fn(async () => structuredClone(note)), config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '0', paused: false })), height: vi.fn(async () => '100'), getCommentRaw: vi.fn(async () => structuredClone(comment)) }
  const options: CommentRequestOptions = { client, session, intents, maxDepositUgnot: '3000000', isWriteEnabled: () => true,
    operation: { caller: owner, noteId, commentId, operationId, action: { kind: 'add', bodyRevision: '2', epoch: '0', anchor: 'Quoted', body: 'Reply' } },
    quote: async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '110', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '2000000', maxDepositUgnot: '3000000', gasWanted: 80000000, networkFeeUgnot: 100000 }) }
  const wallet = { ...liveWallet({ address: owner }), DoContract: vi.fn(async () => ({ status: 'success', data: { hash: txHash } })) }
  Object.assign(window, { adena: wallet })
  return { options, session, intents, wallet, scope: { chainId: GNO_CHAIN_ID, realm: commentIntentRealm(noteId), owner, noteId: commentId }, apply: (patch = {}) => { comment = { ...applied(), ...patch } } }
}
beforeEach(() => {
  clearRpcChainChecks(); __resetGasPriceCache(); setWalletRpcContext(STUB_WALLET_RPC, true, GNO_CHAIN_ID, owner); setTxConfirmationCallback(null); setWalletActionGuard(null)
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input).pathname
    if (path !== '/status' && path !== '/abci_query') throw new Error('Unexpected fixture transport')
    const result = path === '/status' ? { node_info: { network: GNO_CHAIN_ID } } : { response: { ResponseBase: { Data: btoa(JSON.stringify({ gas: '1000', price: '1ugnot' })), Error: null } } }
    return new Response(JSON.stringify({ result }), { status: 200 })
  }))
})
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, 'adena'); setWalletRpcContext(null, false); setTxConfirmationCallback(null); setWalletActionGuard(null); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('composed public comment signing', () => {
  it('persists before wallet access, forwards exact reviewed messages and confirms exact chain evidence', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options), messages = request.prepare(undefined).msgs
    const readAccount = s.wallet.GetAccount.getMockImplementation()!
    s.wallet.GetAccount.mockImplementation(async () => { expect(await s.intents.get(s.scope, operationId)).toMatchObject({ phase: 'prepared', verification: { kind: 'comment-v1' } }); return readAccount() })
    const result = await executeSignature(request, undefined, messages, vi.fn())
    expect(result).toMatchObject({ outcome: 'sent', hash: txHash })
    expect(s.wallet.DoContract).toHaveBeenCalledExactlyOnceWith({ messages: toAdenaMessages(messages), gasFee: 100000, gasWanted: 80000000, memo: '' }, { withNotification: true, isVisibleResult: false })
    s.apply({ body_blob: b64('Different') }); expect(await request.verify!(undefined, txHash, undefined)).toBe(false)
    s.apply(); expect(await request.verify!(undefined, txHash, undefined)).toBe(true)
    expect(await s.intents.get(s.scope, operationId)).toMatchObject({ phase: 'confirmed', txHash: txHash.toUpperCase() })
  })
  it('fails before any wallet read if durable storage is unavailable', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options)
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect((await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())).outcome).toBe('failed')
    expect(s.wallet.GetAccount).not.toHaveBeenCalled(); expect(s.wallet.DoContract).not.toHaveBeenCalled()
  })
  it('retains unknown after wallet closure and refuses a second wallet on the same comment revision', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options)
    s.wallet.DoContract.mockRejectedValueOnce(new Error('rejected by user'))
    expect((await executeSignature(request, undefined, request.prepare(undefined).msgs, vi.fn())).outcome).toBe('unknown')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
    const retry = await preparePublicCommentRequest({ ...s.options, operation: { ...s.options.operation, operationId: '55'.repeat(16) } })
    expect((await executeSignature(retry, undefined, retry.prepare(undefined).msgs, vi.fn())).outcome).toBe('failed')
    expect(s.wallet.DoContract).toHaveBeenCalledOnce()
  })
  it('rejects quote expiry during the last wallet unlock after the Signer rechecks', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options), onWallet = vi.fn()
    let unlock!: (result: { status: string }) => void
    const AddEstablish = vi.fn(() => new Promise<{ status: string }>(resolve => { unlock = resolve }))
    Object.assign(s.wallet, { AddEstablish })
    const account = s.wallet.GetAccount.getMockImplementation()!; let reads = 0
    s.wallet.GetAccount.mockImplementation(async () => ++reads === 2 ? { status: 'failure', type: 'WALLET_LOCKED' } as Awaited<ReturnType<typeof account>> : account())
    const signing = executeSignature(request, undefined, request.prepare(undefined).msgs, onWallet)
    await vi.waitFor(() => expect(AddEstablish).toHaveBeenCalledOnce()); expect(onWallet).toHaveBeenCalledOnce()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000); unlock({ status: 'success' })
    expect((await signing).outcome).toBe('failed'); expect(s.wallet.DoContract).not.toHaveBeenCalled()
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
  })
})
