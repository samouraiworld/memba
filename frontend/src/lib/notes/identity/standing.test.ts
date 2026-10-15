import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDraftSession, createNotesStore, type NotesStore } from '../drafts'
import { createNotesIntents, type NotesIntents } from '../intents'
import type { NotesReadClient } from '../chain/client'
import { identityIntentScope, identityIntentStanding } from './requestRecovery'

// The key and backup reads are not pinned to one height: each decision must rest on one read. The backup record bytes
// here are not a real backup, so the exact-evidence path never confirms and only the standing rules decide.
const owner = 'g1qmylf54c0ujuxenymaaaxwvqqaphyjakuwwze5', chainId = 'onyx-1', op = 'ab'.repeat(16), other = 'cd'.repeat(16)
const stores: NotesStore[] = []
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())) })
async function receipt(): Promise<{ intents: NotesIntents; scope: ReturnType<typeof identityIntentScope> }> {
    const store = createNotesStore({ indexedDB: new IDBFactory() }); stores.push(store)
    const intents = createNotesIntents(store), scope = identityIntentScope(chainId, owner), guard = { signal: new AbortController().signal }
    expect((await intents.begin({ scope, operationId: op, actor: owner, action: 'identity-setup', requestDigest: 'ef'.repeat(32), expectedStateRevision: '0', resultingStateRevision: '1',
        expectedEpoch: '0', ownerGeneration: '0', draftLocalRevision: '0',
        verification: { kind: 'identity-v1', mode: 'standard', generation: '1', backupRevision: '1', publicKeySha256: '12'.repeat(32), backupSha256: '34'.repeat(32), quoteHeight: '100' } }, guard)).status).toBe('saved')
    expect((await intents.settle(scope, op, 'unknown', guard)).status).toBe('saved')
    return { intents, scope }
}
function client(key: { generation: string; operationId: string }, backup: { revision: string; opId: string } | null): NotesReadClient {
    return { chainId, realm: 'gno.land/r/samcrew/memba_notes_rc1', assertCurrent: () => {}, height: async () => '200',
        key: async () => ({ address: owner, generation: key.generation, active: key.generation !== '0', publicKey: new Uint8Array(key.generation !== '0' ? 1216 : 0), operationId: key.operationId, height: '150' }),
        seedBackupRaw: async () => backup && { mode: 1, suite: 'xwing-v1', generation: '1', revision: backup.revision, public_key_hash: 'AA==', op_id: backup.opId, actor: owner, height: '150', record: 'AA==' },
    } as unknown as NotesReadClient
}
async function standing(key: { generation: string; operationId: string }, backup: { revision: string; opId: string } | null) {
    const { intents, scope } = await receipt(), [intent] = await intents.list({ chainId, realm: scope.realm, owner })
    const result = await identityIntentStanding(client(key, backup), intents, intent, createDraftSession())
    return { result, phase: (await intents.get(scope, op))!.phase }
}
describe('identity setup receipt standing', () => {
    it('never settles failed from a torn read: old generation with this operation\'s backup at expected+1', async () => {
        expect(await standing({ generation: '0', operationId: '' }, { revision: '1', opId: op })).toEqual({ result: 'pending', phase: 'unknown' })
    })
    it('keeps blocking while nothing it expected has moved', async () => {
        expect(await standing({ generation: '0', operationId: '' }, null)).toEqual({ result: 'pending', phase: 'unknown' })
    })
    it('settles failed when expected+1 of either compare-and-swap went to another operation (one read each)', async () => {
        expect(await standing({ generation: '1', operationId: other }, null)).toEqual({ result: 'failed', phase: 'failed' })
        expect(await standing({ generation: '0', operationId: '' }, { revision: '1', opId: other })).toEqual({ result: 'failed', phase: 'failed' })
    })
    it('only stops blocking, without deciding, once the chain moved further or holds this operation without exact evidence', async () => {
        expect(await standing({ generation: '2', operationId: other }, { revision: '2', opId: other })).toEqual({ result: 'superseded', phase: 'unknown' })
        expect(await standing({ generation: '0', operationId: '' }, { revision: '2', opId: other })).toEqual({ result: 'superseded', phase: 'unknown' })
        expect(await standing({ generation: '1', operationId: op }, { revision: '1', opId: op })).toEqual({ result: 'superseded', phase: 'unknown' })
    })
})
