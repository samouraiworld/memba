import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents } from '../intents'
import { commentIntentRealm, preparePublicCommentRequest, publicCommentEvidence, recoverPublicCommentIntent, type CommentRequestOptions } from './commentRequest'
import { readPublicComment } from './comments'
import { recoverPublicIntent } from './recovery'
import { encode64, type ChainNote } from './schema'
import { NOTES_REALM } from './__fixtures__/deployment'
import type { CommentOperation } from './commentMessages'
import { publicCommentBudget } from './commentQuote'
import measured from './__fixtures__/notes-storage-363.json'
import { QuoteExpiredError } from '../../../os/sign/expired'
// These suites sign on a test network; the deployment table names the realm path receipts are scoped to.
vi.mock('../config', async importOriginal => ({ ...await importOriginal<typeof import('../config')>(), deploymentRealm: () => 'gno.land/r/samcrew/memba_notes_v1' }))

const wallet = vi.hoisted(() => ({ send: vi.fn(), fee: vi.fn() }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500000000, doContractBroadcast: (...args: unknown[]) => wallet.send(...args), freshFeeForGasWanted: () => wallet.fee(), assertFeeStillCovers: async (fee: number, fresh: () => Promise<number>) => { if (await fresh() > fee) throw new Error('fee changed') } }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), other = bech32Encode('g', new Uint8Array(20).fill(2))
const noteId = '01'.repeat(16), commentId = '02'.repeat(16), operationId = '03'.repeat(16), hash = 'aa'.repeat(32)
const bytes = (s: string) => new TextEncoder().encode(s), b64 = (s: string) => encode64(bytes(s)), stores: NotesStore[] = []
const baseNote = (): ChainNote => ({ id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 4, stateRevision: '5', titleRevision: '1', bodyRevision: '2', epoch: '0', title: bytes('Title'), body: bytes('Body'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '90', operationId: '11'.repeat(16), actor: owner, height: '99' })
const row = () => ({ id: commentId, parent: '0'.repeat(32), author: owner, encrypted: false, body_revision: '2', epoch: '0', revision: '1', anchor_blob: b64('Anchor'), body_blob: b64('Reply'), created_height: '101', op_id: operationId, actor: owner, height: '101', deleted: false, hidden: false, resolved: false })
function setup(action: CommentOperation['action'] = { kind: 'add', bodyRevision: '2', epoch: '0', anchor: 'Anchor', body: 'Reply' }) {
  const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
  const session = createDraftSession(), intents = createNotesIntents(store)
  let note = baseNote(), comment: ReturnType<typeof row> | null = action.kind === 'add' ? null : { ...row(), created_height: '90', height: '99', op_id: '11'.repeat(16) }, paused = false
  const client = { realm: NOTES_REALM, chainId: 'test-chain', assertCurrent: vi.fn(), note: vi.fn(async () => structuredClone(note)), noteMetadata: vi.fn(async () => structuredClone(note)), writersRaw: vi.fn(async () => [] as string[]), config: vi.fn(async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '0', paused })), height: vi.fn(async () => '100'), getCommentRaw: vi.fn(async () => structuredClone(comment)) }
  const options: CommentRequestOptions = { client, operation: { caller: owner, noteId, commentId, operationId, action }, maxDepositUgnot: '3000000', session, intents, isWriteEnabled: () => true,
    quote: async input => ({ chainId: input.chainId, requestDigest: input.requestDigest, atHeight: input.height, expiresAtHeight: '110', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '2000000', maxDepositUgnot: '3000000', gasWanted: 80000000, networkFeeUgnot: 100000 }) }
  const scope = { chainId: client.chainId, realm: commentIntentRealm(NOTES_REALM, noteId), owner, noteId: commentId }
  return { options, store, intents, session, client, scope, setNote: (patch: Partial<ChainNote>) => { note = { ...note, ...patch } }, setComment: (patch: Partial<ReturnType<typeof row>> | null) => { comment = patch === null ? null : { ...row(), ...patch } }, pause: () => { paused = true } }
}
beforeEach(() => { vi.clearAllMocks(); wallet.fee.mockResolvedValue(96000); wallet.send.mockImplementation(async (_msgs, _memo, options) => { await options.beforeSign(); return { hash } }) })
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.close())) })

describe('public comment intentions', () => {
  it('persists an independent exact descriptor before wallet, confirms exact receipt and recovers after reload', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => {
      expect(await s.intents.get(s.scope, operationId)).toMatchObject({ phase: 'prepared', expectedStateRevision: '0', verification: { kind: 'comment-v1', noteId, parent: '', bodyRevision: '2', author: owner } })
      await options.beforeSign(); return { hash }
    })
    await request.send(undefined, async () => () => true)
    expect(await s.intents.list({ ...s.scope, realm: NOTES_REALM })).toEqual([])
    for (const patch of [{ body_blob: b64('Wrong') }, { anchor_blob: b64('Wrong') }, { actor: other }, { author: other }, { hidden: true }, { resolved: true }, { op_id: '44'.repeat(16) }, { parent: '55'.repeat(16) }, { epoch: '1' }, { revision: '2' }, { height: '100', created_height: '100' }]) {
      s.setComment(patch); expect(await request.verify!(undefined, hash, undefined)).toBe(false)
    }
    s.setComment({}); expect(await request.verify!(undefined, hash, undefined)).toBe(true)
    const receipt = (await s.intents.get(s.scope, operationId))!
    expect(await recoverPublicCommentIntent(s.client, createNotesIntents(s.store), receipt, s.session)).toBe('confirmed')
    expect(await recoverPublicIntent(s.client, s.intents, receipt, s.session)).toBe('unknown')
    expect(JSON.stringify(receipt)).not.toContain('Reply')
  })
  it('asks for one confirmation: plain facts first, identifiers and raw arguments folded under technical details', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options)
    expect(request.acks).toBeUndefined()
    const lines = request.lines(undefined), technical = request.technical!(undefined)
    expect(lines.map(([label]) => label)).toEqual(expect.arrayContaining(['Note', 'Comment', 'On', 'Expected storage deposit', 'Maximum storage deposit', 'Network fee']))
    // F20: the note is at revision 5 (its body at body revision 2): the sheet names the note's revision, never the body counter.
    expect(lines).toContainEqual(['On', 'The current text (revision 5)'])
    expect(lines).toContainEqual(['Note', 'Title'])
    expect(lines.find(([label]) => label === 'Expected storage deposit')![1]).toMatch(/ GNOT$/)
    for (const [, value] of lines) expect(value).not.toContain(operationId)
    expect(technical).toEqual(expect.arrayContaining([['Operation', operationId], ['Comment ID', commentId], ['Note ID', noteId], ['Account', owner]]))
    expect(technical.map(([label]) => label)).not.toContain('Network')
  })
  it.each([
    [{ kind: 'hide', revision: '1', hidden: true }], [{ kind: 'resolve', revision: '1', resolved: true }], [{ kind: 'delete', revision: '1' }],
  ] as const)('names the comment a %j review acts on, and the comment it replies to', async action => {
    const s = setup(action); s.setComment({ parent: '05'.repeat(16) })
    const parentRow = { ...row(), id: '05'.repeat(16), op_id: '06'.repeat(16), author: other, body_blob: b64('The original question') }
    s.client.getCommentRaw.mockImplementation(async (_note: string, id: string) => id === '05'.repeat(16) ? structuredClone(parentRow) : structuredClone({ ...row(), created_height: '90', height: '99', op_id: '11'.repeat(16), parent: '05'.repeat(16) }))
    const request = await preparePublicCommentRequest(s.options), lines = request.lines(undefined)
    expect(lines).toContainEqual(['Note', 'Title'])
    expect(lines).toContainEqual(['Comment by', `${owner.slice(0, 5)}…${owner.slice(-4)}`])
    expect(lines).toContainEqual(['Comment', 'Reply'])
    expect(lines).toContainEqual(['Reply to', `${other.slice(0, 5)}…${other.slice(-4)}: The original question`])
  })
  it('says which comment a new reply answers', async () => {
    const s = setup({ kind: 'add', bodyRevision: '2', epoch: '0', anchor: '', body: 'Agreed', parent: '05'.repeat(16) })
    s.client.getCommentRaw.mockImplementation(async (_note: string, id: string) => id === '05'.repeat(16) ? structuredClone({ ...row(), id: '05'.repeat(16), op_id: '06'.repeat(16), author: other, body_blob: b64('Bring a mat?') }) : null)
    const request = await preparePublicCommentRequest(s.options)
    expect(request.lines(undefined)).toContainEqual(['Reply to', `${other.slice(0, 5)}…${other.slice(-4)}: Bring a mat?`])
  })
  it('signs a one-line comment at the price calibrated on the #363 receipts (notes-storage-363.json)', async () => {
    const s = setup({ kind: 'add', bodyRevision: '2', epoch: '0', anchor: '', body: 'I can bring a bamboo mat for rolling.' })
    const request = await preparePublicCommentRequest(s.options), message = request.prepare(undefined).msgs[0]
    const budget = publicCommentBudget(message), worst = Math.max(...measured.rows.filter(r => r.func === 'AddComment').map(r => r.storageDepositDeltaUgnot))
    expect(budget).toMatchObject({ estimatedDepositUgnot: '1773700', suggestedCapUgnot: '2200000', gasWanted: 87000000 })
    expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(worst * 1.24)
    for (const [kind, rowName] of [['hide', 'HideComment'], ['resolve', 'ResolveComment'], ['delete', 'DeleteComment (author)']] as const) {
      const action = kind === 'hide' ? { kind, revision: '1', hidden: true } as const : kind === 'resolve' ? { kind, revision: '1', resolved: true } as const : { kind, revision: '1' } as const
      const other = setup(action); if (kind === 'delete') other.setNote({ deleted: true })
      const priced = publicCommentBudget((await preparePublicCommentRequest(other.options)).prepare(undefined).msgs[0])
      expect(priced).toMatchObject({ estimatedDepositUgnot: '390000', suggestedCapUgnot: '500000' })
      expect(Number(priced.suggestedCapUgnot)).toBeGreaterThanOrEqual(measured.rows.find(r => r.case === rowName)!.storageDepositDeltaUgnot * 1.24)
    }
  })
  it('says an expired price quote in plain words before any wallet (F7)', async () => {
    const s = setup({ kind: 'add', bodyRevision: '2', epoch: '0', anchor: '', body: 'Late comment' })
    const request = await preparePublicCommentRequest(s.options); s.client.height.mockResolvedValue('111')
    await expect(request.recheck!(undefined)).rejects.toThrow(QuoteExpiredError)
    await expect(request.recheck!(undefined)).rejects.toThrow('The price quote expired. Nothing was sent.')
  })
  it('permits author deletion after note deletion/pausing and verifies the exact empty tombstone', async () => {
    const s = setup({ kind: 'delete', revision: '1' }); s.setNote({ deleted: true }); s.pause()
    const request = await preparePublicCommentRequest(s.options); await request.send(undefined, async () => {})
    s.setComment({ revision: '2', deleted: true, anchor_blob: '', body_blob: '' })
    expect(await request.verify!(undefined, hash, undefined)).toBe(true)
  })
  it('confirms owner resolution and moderation only when the exact requested flags appear', async () => {
    for (const action of [{ kind: 'resolve', revision: '1', resolved: true }, { kind: 'hide', revision: '1', hidden: true }] as const) {
      const s = setup(action), request = await preparePublicCommentRequest(s.options)
      await request.send(undefined, async () => {})
      s.setComment({ revision: '2' }); expect(await request.verify!(undefined, hash, undefined)).toBe(false)
      s.setComment({ revision: '2', ...(action.kind === 'hide' ? { hidden: true } : { resolved: true }) })
      expect(await request.verify!(undefined, hash, undefined)).toBe(true)
    }
  })
  it.each([
    [{ kind: 'resolve', revision: '1', resolved: true }, 'Resolve comment', 'Thread after confirmation', 'Resolved', 'ResolveComment', true],
    [{ kind: 'resolve', revision: '1', resolved: false }, 'Reopen comment', 'Thread after confirmation', 'Open', 'ResolveComment', false],
    [{ kind: 'hide', revision: '1', hidden: true }, 'Hide comment', 'Visibility after confirmation', 'Hidden', 'HideComment', true],
    [{ kind: 'hide', revision: '1', hidden: false }, 'Unhide comment', 'Visibility after confirmation', 'Visible', 'HideComment', false],
  ] as const)('reviews %s with the same target state as its signed message', async (action, label, field, target, func, flag) => {
    const s = setup(action)
    s.setComment(action.kind === 'resolve' ? { resolved: !flag } : { hidden: !flag })
    const request = await preparePublicCommentRequest(s.options)
    expect.soft(request.title).toBe(label)
    expect.soft(request.summary).toBe(label)
    expect.soft(request.label(undefined)).toBe(label)
    expect.soft(request.lines(undefined)).toContainEqual([field, target])
    const message = request.prepare(undefined).msgs[0]
    expect(message.value).toMatchObject({ func, args: [encode64(new Uint8Array(16).fill(1)), encode64(new Uint8Array(16).fill(2)), '1', String(flag), encode64(new Uint8Array(16).fill(3))] })
    await request.send(undefined, async () => {})
    expect(wallet.send.mock.calls[0][0]).toEqual([message])
  })
  it('refuses malformed comment descriptors without blocking another note or another comment ID', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options); await request.send(undefined, async () => {})
    const receipt = (await s.intents.get(s.scope, operationId))!
    for (const patch of [{ parent: [commentId] }, { noteId: [noteId] }, { bodySha256: 'bad' }, { deleted: 'yes' }, { quoteHeight: '0' }, { plaintext: 'extra' }]) {
      const malformed = { ...receipt, scope: { ...s.scope, noteId: '88'.repeat(16) }, verification: { ...receipt.verification, ...patch } }
      expect(await s.intents.begin(malformed as typeof receipt, s.session)).toEqual({ status: 'invalid' })
    }
    const another = await preparePublicCommentRequest({ ...s.options, operation: { ...s.options.operation, commentId: '99'.repeat(16) } })
    await another.send(undefined, async () => {}); expect(wallet.send).toHaveBeenCalledTimes(2)
  })
  it('enforces direct owner moderation, author deletion, public add policy and parent liveness', async () => {
    for (const action of [{ kind: 'hide', revision: '1', hidden: true }, { kind: 'resolve', revision: '1', resolved: true }, { kind: 'delete', revision: '1' }] as const) {
      const s = setup(action); s.options.operation.caller = other
      await expect(preparePublicCommentRequest(s.options)).rejects.toThrow('stale')
    }
    const closed = setup(); closed.setNote({ mode: 3 }); closed.options.operation.caller = other
    await expect(preparePublicCommentRequest(closed.options)).rejects.toThrow('stale')
    const open = setup(); open.options.operation.caller = other
    await expect(preparePublicCommentRequest(open.options)).resolves.toHaveProperty('send')
    const paused = setup(); paused.pause(); await expect(preparePublicCommentRequest(paused.options)).rejects.toThrow('stale')
    const reply = setup({ kind: 'add', bodyRevision: '2', epoch: '0', parent: '55'.repeat(16), anchor: '', body: 'Reply' })
    await expect(preparePublicCommentRequest(reply.options)).rejects.toThrow('stale')
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('allows explicit Public writers to comment and rejects a revoked writer before signing', async () => {
    const s = setup(); s.setNote({ mode: 3 }); s.options.operation.caller = other
    s.client.writersRaw.mockResolvedValue([other])
    const request = await preparePublicCommentRequest(s.options)
    s.client.writersRaw.mockResolvedValue([])
    await expect(request.send(undefined, async () => {})).rejects.toThrow('stale')
    expect(wallet.send).toHaveBeenCalledOnce()
    expect((await s.intents.get({ ...s.scope, owner: other }, operationId))?.phase).toBe('not-sent')
  })
  it('lets an explicit Public writer resolve a comment and verifies that writer receipt', async () => {
    const s = setup({ kind: 'resolve', revision: '1', resolved: true })
    s.setNote({ mode: 3 }); s.options.operation.caller = other
    s.client.writersRaw.mockResolvedValue([other])
    const request = await preparePublicCommentRequest(s.options)
    await request.send(undefined, async () => {})
    s.setComment({ revision: '2', resolved: true, actor: other })
    expect(await request.verify!(undefined, hash, undefined)).toBe(true)
    expect((await s.intents.get({ ...s.scope, owner: other }, operationId))?.phase).toBe('confirmed')
  })
  it('rechecks writer resolution rights before opening the wallet', async () => {
    const s = setup({ kind: 'resolve', revision: '1', resolved: true })
    s.setNote({ mode: 3 }); s.options.operation.caller = other
    s.client.writersRaw.mockResolvedValue([other])
    const request = await preparePublicCommentRequest(s.options)
    s.client.writersRaw.mockResolvedValue([])
    const beforeWallet = vi.fn(async () => {})
    await expect(request.send(undefined, beforeWallet)).rejects.toThrow('stale')
    expect(beforeWallet).not.toHaveBeenCalled()
    expect((await s.intents.get({ ...s.scope, owner: other }, operationId))?.phase).toBe('not-sent')
  })
  it('keeps Public open resolution and hiding owner-only for explicit writers', async () => {
    for (const [mode, kind] of [[4, 'resolve'], [3, 'hide']] as const) {
      const s = setup(kind === 'resolve' ? { kind, revision: '1', resolved: true } : { kind, revision: '1', hidden: true })
      s.setNote({ mode }); s.options.operation.caller = other
      s.client.writersRaw.mockResolvedValue([other])
      await expect(preparePublicCommentRequest(s.options)).rejects.toThrow('stale')
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('does not consult a community content grant for Resolve/Reopen or Hide/Unhide', async () => {
    for (const action of [
      { kind: 'resolve', revision: '1', resolved: true }, { kind: 'resolve', revision: '1', resolved: false },
      { kind: 'hide', revision: '1', hidden: true }, { kind: 'hide', revision: '1', hidden: false },
    ] as const) {
      const s = setup(action), publicCapabilities = vi.fn(async () => ({ id: noteId, stateRevision: '5', ownerGeneration: '1', mode: 4, deleted: false, allowPublicWrites: true }))
      Object.assign(s.client, { publicCapabilities }); s.options.operation.caller = other
      await expect(preparePublicCommentRequest(s.options)).rejects.toThrow('stale')
      expect(publicCapabilities).not.toHaveBeenCalled()
    }
    expect(wallet.send).not.toHaveBeenCalled()
  })
  it('retains unknown on wallet uncertainty and never retries the same comment revision', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('wallet closed') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('wallet closed')
    expect((await s.intents.get(s.scope, operationId))?.phase).toBe('unknown')
    const next = await preparePublicCommentRequest({ ...s.options, operation: { ...s.options.operation, operationId: '66'.repeat(16) } })
    await expect(next.send(undefined, async () => {})).rejects.toThrow('storage')
    expect(wallet.send).toHaveBeenCalledOnce()
    s.setComment({ op_id: '77'.repeat(16) })
    expect(await recoverPublicCommentIntent(s.client, s.intents, (await s.intents.get(s.scope, operationId))!, s.session)).toBe('unknown')
    s.setComment({})
    expect(await recoverPublicCommentIntent(s.client, s.intents, (await s.intents.get(s.scope, operationId))!, s.session)).toBe('confirmed')
  })
  it('never confirms a comment receipt made under another realm path, nor reads the chain for it', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options), other = 'gno.land/r/samcrew/memba_notes_rehearsal'
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { await options.beforeSign(); throw new Error('wallet closed') })
    await expect(request.send(undefined, async () => {})).rejects.toThrow('wallet closed')
    s.setComment({}); s.client.getCommentRaw.mockClear(); const receipt = (await s.intents.get(s.scope, operationId))!
    expect(await recoverPublicCommentIntent({ ...s.client, realm: other }, s.intents, receipt, s.session)).toBe('unknown')
    expect(s.client.getCommentRaw).not.toHaveBeenCalled()
    const comment = await readPublicComment(s.client, noteId, commentId)
    expect(publicCommentEvidence(other, receipt, comment)).toBeNull()
    expect(publicCommentEvidence(NOTES_REALM, receipt, comment)).not.toBeNull()
    expect(await recoverPublicCommentIntent(s.client, s.intents, receipt, s.session)).toBe('confirmed')
  })
  it('rechecks note/comment revisions, account lifetime, fee and final quote expiry', async () => {
    const s = setup(), request = await preparePublicCommentRequest(s.options); s.setNote({ stateRevision: '6' })
    await expect(request.recheck!(undefined)).rejects.toThrow('stale')
    const t = setup({ kind: 'hide', revision: '1', hidden: true }), hide = await preparePublicCommentRequest(t.options)
    t.setComment({ revision: '2' }); await expect(hide.recheck!(undefined)).rejects.toThrow('stale')
    const u = setup(), stale = await preparePublicCommentRequest(u.options); u.session.invalidate()
    await expect(stale.send(undefined, async () => {})).rejects.toThrow('session')
    const v = setup(), expiring = await preparePublicCommentRequest(v.options)
    wallet.send.mockImplementationOnce(async (_msgs, _memo, options) => { const guard = await options.beforeSign(); vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000); expect(guard()).toBe(false); throw new Error('expired') })
    await expect(expiring.send(undefined, async () => () => true)).rejects.toThrow('expired')
  })
})
