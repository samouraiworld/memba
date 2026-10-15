import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { encode64, type ChainNote } from '../../../../lib/notes/chain/schema'
import { NOTES_REALM } from '../../../../lib/notes/chain/__fixtures__/deployment'
import { identityFromSeed } from '../../../../lib/notes/crypto/identity'
import { decodeManifest } from '../../../../lib/notes/crypto/manifest'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { openPrivateDraft, prepareEncryptedEpoch, sealPrivateDraft } from '../../../../lib/notes/private'
import type { SignRequest } from '../../../sign/signer'
import { PrivateDraftEditor } from './PrivateDraftEditor'

// The real local-draft codec, sealer, reader and request builder on fake-indexeddb; the key controller is a stub around a
// real X-Wing identity, and the network, the signature sheet and the fee read are stubs. Nothing is signed.
const io = vi.hoisted(() => ({ open: true, sign: vi.fn() }))
vi.mock('../../terminal/CodeEditor', () => ({ CodeEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="Markdown editor" value={value} onChange={event => onChange(event.target.value)} /> }))
vi.mock('../../../../lib/notes/render', () => ({ createNotesRenderer: () => ({ render: async (text: string) => ({ kind: 'text', text }), dispose() {} }) }))
vi.mock('../../../sign/signerContext', () => ({ useSigner: () => ({ sign: io.sign }) }))
vi.mock('../../../../lib/grc20', async original => ({ ...await original<typeof import('../../../../lib/grc20')>(), freshFeeForGasWanted: async (gas: number) => Math.ceil(gas * 1.2 / 1000) }))
vi.mock('../../../../lib/dao/packageStatus', () => ({ abciQueryText: async (_ctx: unknown, path: string) => { if (path === 'params/vm:p:storage_price') return '"100ugnot"'; throw new Error('offline') } }))
vi.mock('../../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../../lib/notes/config')>(),
    notesDeployment: (chainId: string) => chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null,
    deploymentRealm: () => NOTES_REALM,
    privateNotesDeployment: (chainId: string) => io.open && chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null }))

const owner = bech32Encode('g', new Uint8Array(20).fill(1)), noteId = 'cd'.repeat(16), chainId = 'test-chain-id'
const identity = identityFromSeed(new Uint8Array(32).fill(8))
const registry = { address: owner, generation: '1', active: true, publicKey: identity.publicKey, operationId: '11'.repeat(16), height: '5' }
const published = { title: 'Field guide', body: 'Published private text' }
const TYPED = 'Typed secret that must stay encrypted on disk', TITLE = 'Renamed secret title'
const scope = { chainId, realm: NOTES_REALM, owner, noteId }
let store: NotesStore, indexedDB: IDBFactory, note: ChainNote, phase: 'unlocked' | 'locked'
const listeners = new Set<() => void>()
const controller = { getSnapshot: () => ({ phase, generation: '1', busy: false }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    use: async (fn: (value: typeof identity) => unknown) => fn(identity) } as unknown as NotesIdentityController
function client(): NotesReadClient {
    const created = prepareEncryptedEpoch({ chainId, realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 0, owner, recipients: [{ key: registry, writer: true }], ...published })
    const entry = decodeManifest(created.manifest, 1)[0]
    note = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 0, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: created.title, body: created.body,
        commitment: created.commitment, deleted: false, listed: false, createdHeight: '4', operationId: '22'.repeat(16), actor: owner, height: '4' }
    return { chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10', note: async () => note, noteMetadata: async () => note, key: async () => ({ ...registry }), readersRaw: async () => [owner],
        config: async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }),
        wrapRaw: async () => ({ address: owner, epoch: '1', writer: true, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) }),
        epochMetadataRaw: async () => ({ items: [{ epoch: '1', commitment: encode64(created.commitment), revealed_key: '' }], next_cursor: '1' }),
        simulateRaw: async () => { throw new Error('offline') } } as unknown as NotesReadClient
}
/** As PrivateNoteView renders it: only while the key is unlocked. */
function Harness({ reader }: { reader: NotesReadClient }) {
    const now = useSyncExternalStore(controller.subscribe, () => controller.getSnapshot().phase)
    return now === 'unlocked' ? <PrivateDraftEditor store={store} client={reader} controller={controller} owner={owner} note={note} published={published} onClose={() => {}} /> : <p>Locked</p>
}
/** Every record of the device's Notes database, as the text an attacker with the disk would see. */
async function disk(): Promise<string> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('memba_notes_local_v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try {
        const all = await Promise.all(['drafts', 'intents'].map(name => new Promise<unknown[]>((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
        return JSON.stringify(all, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value)
    } finally { database.close() }
}
const bytes = (value: string) => new TextEncoder().encode(value)
const traces = (value: string) => [value, bytesToHex(sha256(bytes(value))), encode64(bytes(value)), btoa(value.slice(0, 18)), Array.from(bytes(value).subarray(0, 16)).join(',')]
async function stored() {
    const record = (await store.getDraft(scope))!
    expect(record.payload.kind).toBe('encrypted')
    return { record, text: openPrivateDraft(scope, BigInt(record.localRevision), 1n, identity, (record.payload as { envelope: Uint8Array }).envelope) }
}
async function opened(reader = client()) {
    render(<Harness reader={reader} />)
    return await screen.findByLabelText('Markdown editor', {}, { timeout: 3000 })
}
beforeEach(() => { indexedDB = new IDBFactory(); store = createNotesStore({ indexedDB }); phase = 'unlocked'; listeners.clear(); io.open = true; vi.clearAllMocks(); io.sign.mockReturnValue(true) })
afterEach(async () => { cleanup(); await store.close() })

describe('editing a private note on this device', () => {
    it('keeps the draft encrypted at rest: no plaintext, plaintext hash or base64 in any IndexedDB record', async () => {
        // A plaintext copy left by the publication (D1) is replaced by the encrypted draft when editing starts.
        expect((await store.saveDraft(scope, '0', { kind: 'public', title: published.title, body: published.body }, createDraftSession())).status).toBe('saved')
        const editor = await opened()
        for (const trace of traces(published.body)) expect(await disk()).not.toContain(trace)
        expect((await stored()).text).toEqual({ ...published, mode: 0, base: { stateRevision: '1', epoch: '1', ownerGeneration: '1', titleRevision: '1', bodyRevision: '1' } })
        fireEvent.change(screen.getByLabelText('Note title'), { target: { value: TITLE } }); fireEvent.change(editor, { target: { value: TYPED } })
        await waitFor(async () => expect((await stored()).text.body).toBe(TYPED), { timeout: 3000 })
        const raw = await disk()
        for (const trace of [...traces(TYPED), ...traces(TITLE), ...traces(published.title)]) expect(raw).not.toContain(trace)
        expect((await stored()).text.title).toBe(TITLE)
    })
    it('never overwrites a draft another window saved meanwhile (compare-and-swap on the local revision)', async () => {
        const editor = await opened(), { record } = await stored()
        const other = sealPrivateDraft(scope, BigInt(record.localRevision) + 1n, 1n, identity.publicKey, { title: 'Other window', body: 'Saved elsewhere', mode: 0 })
        expect((await store.saveDraft(scope, record.localRevision, { kind: 'encrypted', envelope: other }, createDraftSession())).status).toBe('saved')
        fireEvent.change(editor, { target: { value: TYPED } })
        expect(await screen.findByText(/This private draft changed in another window/, {}, { timeout: 3000 })).toBeVisible()
        expect(screen.getByLabelText('Markdown editor')).toHaveValue(TYPED)
        expect((await stored()).text.body).toBe('Saved elsewhere')
    })
    it('a lock mid-edit stores the last edits encrypted and clears the plaintext from the screen; reopening needs the key', async () => {
        const editor = await opened()
        fireEvent.change(editor, { target: { value: TYPED } })
        act(() => { phase = 'locked'; listeners.forEach(fn => fn()) })
        expect(screen.queryByLabelText('Markdown editor')).toBeNull(); expect(document.body.textContent).not.toContain(TYPED)
        await waitFor(async () => expect((await stored()).text.body).toBe(TYPED))
        for (const trace of traces(TYPED)) expect(await disk()).not.toContain(trace)
    })
    it('saves nothing once private notes close: the edits are dropped, never stored unencrypted', async () => {
        const editor = await opened(), { record } = await stored()
        io.open = false
        fireEvent.change(editor, { target: { value: TYPED } })
        expect(await screen.findByText(/could not save your edits encrypted/, {}, { timeout: 3000 })).toBeVisible()
        expect((await store.getDraft(scope))!.localRevision).toBe(record.localRevision)
        cleanup(); await new Promise(resolve => setTimeout(resolve, 50))
        expect((await store.getDraft(scope))!.localRevision).toBe(record.localRevision)
        for (const trace of traces(TYPED)) expect(await disk()).not.toContain(trace)
    })
})

describe('publishing private changes', () => {
    it('quotes the growth only (M0 Commit rule), then hands a ciphertext-only Commit to the signature sheet', async () => {
        const editor = await opened()
        fireEvent.change(editor, { target: { value: TYPED } })
        const publish = screen.getByRole('button', { name: 'Publish' })
        await waitFor(() => expect(publish).toBeEnabled(), { timeout: 3000 })
        fireEvent.click(publish)
        expect(await screen.findByText(/for the extra size only; no publication fee/)).toBeVisible()
        expect(screen.getByText(/At most 0.1 GNOT, written in the transaction/)).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Publish with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(message.value).toMatchObject({ func: 'Commit', pkg_path: NOTES_REALM, max_deposit: '100000ugnot' }); expect(message.value.args[3]).toBe('2')
        for (const trace of traces(TYPED)) expect(JSON.stringify(message)).not.toContain(trace)
    })
    it('refuses before the signature sheet when private notes close during the review', async () => {
        const editor = await opened()
        fireEvent.change(editor, { target: { value: TYPED } })
        const publish = screen.getByRole('button', { name: 'Publish' })
        await waitFor(() => expect(publish).toBeEnabled(), { timeout: 3000 })
        fireEvent.click(publish); await screen.findByText(/for the extra size only/)
        io.open = false
        fireEvent.click(screen.getByRole('button', { name: 'Publish with Adena' }))
        expect(await screen.findByText(/Private notes are not available on this network right now. Nothing was sent./)).toBeVisible()
        expect(io.sign).not.toHaveBeenCalled()
    })
})
