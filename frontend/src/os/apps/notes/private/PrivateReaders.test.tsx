import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { IDBFactory } from 'fake-indexeddb'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../../lib/notes/drafts'
import type { SignRequest } from '../../../sign/signer'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { blob, encode64, type ChainNote } from '../../../../lib/notes/chain/schema'
import { NOTES_REALM } from '../../../../lib/notes/chain/__fixtures__/deployment'
import { identityFromSeed } from '../../../../lib/notes/crypto/identity'
import { decodeManifest } from '../../../../lib/notes/crypto/manifest'
import { createIdentityController } from '../../../../lib/notes/privateNotes'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { prepareEncryptedEpoch } from '../../../../lib/notes/private/engine'
import { sealPrivateDraft } from '../../../../lib/notes/private/localDraft'
import golden from '../../../../lib/notes/identity/__fixtures__/backup-standard.json'
import { PrivateNoteView } from './PrivateNoteView'
import { SharedWithMe } from './SharedWithMe'

// PR E: "Who can read" in a private note's Share menu, with the real key controller (unlocked from the real Standard
// backup; only the KDF and Adena's signature are mocked) and a note sealed with real X-Wing envelopes. Nothing is signed:
// the flow stops at the OS signature sheet (mocked).
const io = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn(), open: true, sign: vi.fn(), resolve: vi.fn() }))
vi.mock('../../../sign/signerContext', () => ({ useSigner: () => ({ sign: io.sign }) }))
vi.mock('../../../../lib/grc20', async original => ({ ...await original<typeof import('../../../../lib/grc20')>(), freshFeeForGasWanted: async (gas: number) => Math.ceil(gas * 1.2 / 1000),
    assertFeeStillCovers: async () => {}, doContractBroadcast: vi.fn() }))
vi.mock('../../../../lib/dao/packageStatus', () => ({ abciQueryText: async (_ctx: unknown, path: string) => { if (path === 'params/vm:p:storage_price') return '"100ugnot"'; throw new Error('offline') } }))
vi.mock('../../../../lib/dao/shared', async original => ({ ...await original<typeof import('../../../../lib/dao/shared')>(), resolveUsernameToAddress: (...args: unknown[]) => io.resolve(...args) }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => io.kdf(...args) }))
vi.mock('../../../../lib/notes/crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => io.unlock(...args) }))
vi.mock('../../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../../lib/notes/config')>(),
    deploymentRealm: () => NOTES_REALM,
    notesDeployment: (chainId: string) => chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null,
    privateNotesDeployment: (chainId: string) => io.open && chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null }))
vi.mock('../../../../lib/notes/render', () => ({ createNotesRenderer: () => ({ render: async (body: string) => ({ kind: 'text', text: body, reason: 'timeout', truncated: false }), dispose: () => {} }) }))

const owner = bech32Encode('g', hexToBytes(golden.addressHex)), reader = bech32Encode('g', new Uint8Array(20).fill(5)), nokey = bech32Encode('g', new Uint8Array(20).fill(6))
/** Readers whose private-notes key was turned off after the note was shared with them. */
const off1 = bech32Encode('g', new Uint8Array(20).fill(7)), off2 = bech32Encode('g', new Uint8Array(20).fill(8))
const newcomer = bech32Encode('g', new Uint8Array(20).fill(9)), newcomerKey = identityFromSeed(new Uint8Array(32).fill(13)).publicKey
const publicKey = blob(golden.publicKeyBase64, 1216), readerKey = identityFromSeed(new Uint8Array(32).fill(3)).publicKey, noteId = 'cd'.repeat(16)
const key = (address: string, pk: Uint8Array) => ({ address, generation: '1', active: true, publicKey: pk, operationId: '11'.repeat(16), height: '5' })
let note: ChainNote, manifest: Uint8Array, controller: NotesIdentityController, store: NotesStore
/** The session's verified nodes, and what a node pinned by `via` serves instead of `note` (a dishonest or lagging one). */
let nodes: string[] = ['https://rpc.one'], served: Record<string, ChainNote> = {}
/** A note of `noteOwner`, sealed for its owner and `readers` (those in `writers` with the writer flag). */
function seal(noteOwner = owner, readers: string[] = [], writers: string[] = []) {
    const keys: Record<string, Uint8Array> = { [owner]: publicKey, [reader]: readerKey, [off1]: identityFromSeed(new Uint8Array(32).fill(11)).publicKey, [off2]: identityFromSeed(new Uint8Array(32).fill(12)).publicKey }
    const sealed = prepareEncryptedEpoch({ chainId: golden.chainId, realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: readers.length ? 1 : 0, owner: noteOwner,
        recipients: [{ key: key(noteOwner, keys[noteOwner]), writer: true }, ...readers.map(who => ({ key: key(who, keys[who]), writer: writers.includes(who) }))], title: 'Tuna tataki', body: 'Sear **30 seconds** a side.' })
    manifest = sealed.manifest
    note = { id: noteId, owner: noteOwner, pendingOwner: '', ownerGeneration: '1', mode: sealed.mode, stateRevision: '3', titleRevision: '1', bodyRevision: '1', epoch: '1', title: sealed.title, body: sealed.body,
        commitment: sealed.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '22'.repeat(16), actor: noteOwner, height: '9', bodyBytes: sealed.body.length }
}
function client(): NotesReadClient {
    const entries = () => decodeManifest(manifest, 1)
    return { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10',
        config: async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }),
        key: async (who: string) => who === owner ? key(owner, publicKey) : who === reader ? key(reader, readerKey) : who === newcomer ? key(newcomer, newcomerKey)
            : [off1, off2].includes(who) ? { address: who, generation: '1', active: false, publicKey: new Uint8Array(), operationId: '11'.repeat(16), height: '6' }
            : { address: who, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' },
        seedBackupRaw: async () => ({ mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(hexToBytes(golden.publicKeyHashHex)), op_id: '11'.repeat(16), actor: owner, height: '5', record: golden.recordBase64 }),
        nodes: () => nodes, note: async (_id: string, via?: string) => via && served[via] ? served[via] : note, noteMetadata: async () => note, readersRaw: async () => entries().map(entry => bech32Encode('g', entry.address)),
        writersRaw: async () => entries().filter(entry => entry.writer).map(entry => bech32Encode('g', entry.address)).filter(who => who !== note.owner),
        wrapRaw: async (_id: string, _epoch: string, who: string) => {
            const entry = entries().find(e => bech32Encode('g', e.address) === who)
            return entry ? { address: who, epoch: '1', writer: entry.writer, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) } : null
        },
        epochMetadataRaw: async () => ({ items: [{ epoch: '1', commitment: encode64(note.commitment), revealed_key: '' }], next_cursor: '1' }),
        sharedWith: vi.fn(async () => ({ items: [], nextCursor: '' })),
    } as unknown as NotesReadClient
}
function show(reader = client()) {
    controller ??= createIdentityController(reader, owner, createDraftSession())
    return render(<PrivateNoteView note={note} controller={controller} client={reader} owner={owner} store={store} />)
}
async function openShare(unlock = true) {
    if (unlock) { fireEvent.click(await screen.findByRole('button', { name: 'Unlock' })); expect(await screen.findByRole('heading', { name: 'Tuna tataki' })).toBeVisible() }
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    return within(await screen.findByRole('region', { name: 'Who can read' }))
}
beforeEach(() => {
    vi.clearAllMocks(); io.open = true; nodes = ['https://rpc.one']; served = {}; controller = undefined as unknown as NotesIdentityController; store = createNotesStore({ indexedDB: new IDBFactory() }); seal()
    io.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
    io.unlock.mockImplementation(async () => ({ ikm: hexToBytes(golden.materialHex), publicKey: new Uint8Array(33) }))
    io.sign.mockReturnValue(true)
})
afterEach(async () => { cleanup(); controller?.dispose(); await store.close() })

describe('Who can read (owner)', () => {
    it('locked: lists the readers with no key and asks to unlock before any change', async () => {
        seal(owner, [reader]); show()
        const part = await openShare(false)
        await waitFor(() => expect(part.getByText('You')).toBeVisible())
        expect(part.getByTitle(reader)).toHaveTextContent(`${reader.slice(0, 5)}…${reader.slice(-4)}`)
        expect(part.getByText('Unlock this note to add or remove readers, or to change who can edit.')).toBeVisible()
        expect(part.queryByRole('textbox')).toBeNull(); expect(part.getByRole('button', { name: 'Remove…' })).toBeDisabled()
        expect(part.getByRole('checkbox', { name: 'Can edit' })).toBeDisabled(); expect(part.getByRole('checkbox', { name: 'Can edit' })).not.toBeChecked()
        expect(io.unlock).not.toHaveBeenCalled(); expect(document.body).not.toHaveTextContent('Comment')
        expect(screen.getByText(/the link opens it only for its owner and the people it is shared with/)).toBeVisible()
    })
    it('refuses, before any encryption or wallet, someone who has no private notes key, a bad address and themselves', async () => {
        show()
        const part = await openShare()
        const add = async (value: string) => { fireEvent.change(part.getByRole('textbox', { name: 'Add a reader' }), { target: { value } }); fireEvent.click(part.getByRole('button', { name: 'Add…' })) }
        await add(nokey)
        expect(await part.findByText(/They need to set up private notes first/)).toBeVisible()
        await add('g1notanaddress000000000000000000'); expect(await part.findByText(/not a valid g1 address/)).toBeVisible()
        await add(owner); expect(await part.findByText(/That is you/)).toBeVisible()
        io.resolve.mockResolvedValueOnce(''); await add('@nobody'); expect(await part.findByText('@nobody is not a registered username.')).toBeVisible()
        expect(io.sign).not.toHaveBeenCalled()
    })
    it('adds a reader by username: the review says their address becomes public and what they can read, with the M0 cost, then opens the signature sheet', async () => {
        io.resolve.mockResolvedValue(reader)
        show()
        const part = await openShare()
        fireEvent.change(part.getByRole('textbox', { name: 'Add a reader' }), { target: { value: '@sushi' } }); fireEvent.click(part.getByRole('button', { name: 'Add…' }))
        const review = within(await part.findByRole('group', { name: 'Share review' }))
        expect(review.getByText(/Share with @sushi/)).toBeVisible()
        expect(review.getByText('Their address, as a reader of this note. Not the title or the text.')).toBeVisible()
        expect(review.getByText(/its earlier versions since its key last changed/)).toBeVisible()
        expect(review.getByText('≈ 0.38 GNOT')).toBeVisible(); expect(review.getByText(/At most 0.5 GNOT/)).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Share with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest
        expect(request.title).toBe('Share private note'); expect(request.lines(undefined)).toContainEqual(['Adds', reader])
        expect(JSON.stringify(request.prepare(undefined).msgs)).not.toContain('Tuna'); expect(request.prepare(undefined).msgs[0].value.func).toBe('ApplyAccess')
        expect(await part.findByText(/Waiting for your signature/)).toBeVisible()
    })
    it('removes a reader with a new key: "They keep what they already read; new versions are hidden from them"', async () => {
        seal(owner, [reader]); show()
        const part = await openShare()
        fireEvent.click(await part.findByRole('button', { name: 'Remove…' }))
        const review = within(await part.findByRole('group', { name: 'Removal review' }))
        expect(review.getByText(/They keep what they already read; new versions are hidden from them/)).toBeVisible()
        expect(review.getByText(/encrypted again for you only/)).toBeVisible(); expect(review.getByText(/At most 0.7 GNOT/)).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Remove with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(request.title).toBe('Remove a reader'); expect(message.value.func).toBe('Rotate'); expect(message.value.args[3]).toBe('0')
        expect(JSON.stringify(message)).not.toContain('Tuna')
    })
    it('drops a prepared review when the key locks, and refuses when private notes close', async () => {
        io.resolve.mockResolvedValue(reader)
        show()
        const part = await openShare()
        fireEvent.change(part.getByRole('textbox', { name: 'Add a reader' }), { target: { value: '@sushi' } }); fireEvent.click(part.getByRole('button', { name: 'Add…' }))
        await part.findByRole('group', { name: 'Share review' })
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
        await waitFor(() => expect(part.queryByRole('group', { name: 'Share review' })).toBeNull())
        expect(io.sign).not.toHaveBeenCalled()
    })
})

describe('Who can read with readers whose key is turned off (review P2: no deadlock)', () => {
    it('removing an active reader also removes every turned-off one, named in the review and the signing sheet', async () => {
        seal(owner, [reader, off1, off2]); show()
        const part = await openShare()
        fireEvent.click(await part.findByTitle(reader).then(row => within(row.parentElement!).getByRole('button', { name: 'Remove…' })))
        const review = within(await part.findByRole('group', { name: 'Removal review' }))
        expect(review.getByText(/because their private-notes key is turned off/)).toHaveTextContent(`${off1.slice(0, 5)}…${off1.slice(-4)}, ${off2.slice(0, 5)}…${off2.slice(-4)}`)
        fireEvent.click(review.getByRole('button', { name: 'Remove with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(message.value.func).toBe('Rotate'); expect(message.value.args[3]).toBe('0')
        expect(decodeManifest(blob(message.value.args[6], 41570), 2).map(entry => bech32Encode('g', entry.address))).toEqual([owner])
        expect(request.lines(undefined)).toContainEqual(['Removes', reader])
        expect(request.lines(undefined)).toContainEqual(['Also removed because their private-notes key is turned off', [off1, off2].join(', ')])
    })
    it('adding stays a pure ApplyAccess: refused with the way out, which removes only the turned-off readers', async () => {
        seal(owner, [reader, off1, off2]); show()
        const part = await openShare()
        fireEvent.change(part.getByRole('textbox', { name: 'Add a reader' }), { target: { value: newcomer } })
        fireEvent.click(part.getByRole('button', { name: 'Add…' }))
        expect(await part.findByText(/turned off their private-notes key, so nobody can be added until they are removed/)).toBeVisible()
        fireEvent.click(part.getByRole('button', { name: 'Remove them…' }))
        const review = within(await part.findByRole('group', { name: 'Removal review' }))
        expect(review.getByText('Remove the readers whose key is turned off?')).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Remove with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(message.value.args[3]).toBe('1')
        expect(decodeManifest(blob(message.value.args[6], 41570), 2).map(entry => bech32Encode('g', entry.address)).sort()).toEqual([owner, reader].sort())
        expect(request.lines(undefined).some(([name]) => name === 'Removes')).toBe(false)
    })
})

describe('Who can read (a reader)', () => {
    it('shows the list without any control', async () => {
        seal(reader, [owner]); show()
        const part = await openShare(false)
        await waitFor(() => expect(part.getByText('owner · can edit')).toBeVisible())
        expect(part.queryByRole('button', { name: 'Remove…' })).toBeNull(); expect(part.queryByRole('textbox')).toBeNull(); expect(part.queryByRole('checkbox')).toBeNull()
        expect(part.queryByText(/Unlock this note to add or remove readers/)).toBeNull(); expect(part.queryByText('can edit')).toBeNull()
    })
})

// E2: "Can edit" for a reader (owner only). Real envelopes; nothing is signed (the flow stops at the OS signature sheet).
describe('Who can edit (owner)', () => {
    it('makes a reader a writer: ApplyAccess with their writer flag, the review says what they can do and that the owner keeps the rest, with the keeper cost', async () => {
        seal(owner, [reader]); show()
        const part = await openShare()
        const toggle = await part.findByRole('checkbox', { name: 'Can edit' })
        await waitFor(() => expect(toggle).toBeEnabled()); expect(toggle).not.toBeChecked()
        fireEvent.click(toggle)
        const review = within(await part.findByRole('group', { name: 'Editing review' }))
        expect(review.getByText(new RegExp(`^Let ${reader.slice(0, 5)}.*edit\\?$`))).toBeVisible()
        expect(review.getByText(/Change the title and the text, and publish those changes/)).toBeVisible()
        expect(review.getByText(/only you share the note, remove readers, change who can edit or delete it/)).toBeVisible()
        expect(review.getByText('Their address, as a writer of this note. Not the title or the text.')).toBeVisible()
        expect(review.getByText('≈ 0.06 GNOT')).toBeVisible(); expect(review.getByText(/At most 0.1 GNOT/)).toBeVisible()
        // The list still shows the chain's role until the change is confirmed.
        expect(part.getByRole('checkbox', { name: 'Can edit' })).not.toBeChecked()
        fireEvent.click(review.getByRole('button', { name: 'Allow editing with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(request.title).toBe('Let a reader edit'); expect(message.value.func).toBe('ApplyAccess'); expect(message.value.args[3]).toBe('1')
        expect(decodeManifest(blob(message.value.args[4], 41570), 1).map(entry => [bech32Encode('g', entry.address), entry.writer]).sort()).toEqual([[owner, true], [reader, true]].sort())
        expect(request.lines(undefined)).toContainEqual(['Can edit from now on', reader]); expect(request.lines(undefined)).toContainEqual(['Who can edit', `You and ${reader}`])
        expect(JSON.stringify(message)).not.toContain('Tuna')
    })
    it('makes a writer a reader again with a new key (Rotate, every holder kept): they still read, they can no longer publish changes', async () => {
        seal(owner, [reader], [reader]); show()
        const part = await openShare()
        const toggle = await part.findByRole('checkbox', { name: 'Can edit' })
        await waitFor(() => expect(toggle).toBeEnabled()); expect(toggle).toBeChecked()
        fireEvent.click(toggle)
        const review = within(await part.findByRole('group', { name: 'End of editing review' }))
        expect(review.getByText(/They can still read the note, but can no longer publish changes/)).toBeVisible()
        expect(review.getByText(/only with a new key: the current text is encrypted again for you and them/)).toBeVisible()
        expect(review.getByText(/At most 0.8 GNOT/)).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Stop editing with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(request.title).toBe('Stop a writer editing'); expect(message.value.func).toBe('Rotate'); expect(message.value.args[3]).toBe('1')
        expect(decodeManifest(blob(message.value.args[6], 41570), 2).map(entry => [bech32Encode('g', entry.address), entry.writer]).sort()).toEqual([[owner, true], [reader, false]].sort())
        expect(request.lines(undefined)).toContainEqual(['Can no longer edit', reader]); expect(request.lines(undefined).some(([name]) => name === 'Removes')).toBe(false)
        expect(JSON.stringify(message)).not.toContain('Tuna')
    })
    it('a new writer is a pure ApplyAccess: refused while a holder’s key is turned off, with the way out; ending editing drops them in the same Rotate, named', async () => {
        seal(owner, [reader, off1]); show()
        const part = await openShare()
        const row = within((await part.findByTitle(reader)).parentElement!)
        await waitFor(() => expect(row.getByRole('checkbox', { name: 'Can edit' })).toBeEnabled())
        fireEvent.click(row.getByRole('checkbox', { name: 'Can edit' }))
        expect(await part.findByText(/turned off their private-notes key, so nobody can be made a writer until they are removed/)).toBeVisible()
        expect(part.getByRole('button', { name: 'Remove them…' })).toBeVisible(); expect(io.sign).not.toHaveBeenCalled()
        // The turned-off holder's own role cannot change: remove them instead.
        fireEvent.click(within(part.getByTitle(off1).parentElement!).getByRole('checkbox', { name: 'Can edit' }))
        expect(await part.findByText(/Their private-notes key is turned off, so their access cannot change: remove them instead/)).toBeVisible()
        cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
        seal(owner, [reader, off1], [reader]); show()
        const again = await openShare()
        const writerRow = within((await again.findByTitle(reader)).parentElement!)
        await waitFor(() => expect(writerRow.getByRole('checkbox', { name: 'Can edit' })).toBeEnabled())
        fireEvent.click(writerRow.getByRole('checkbox', { name: 'Can edit' }))
        const review = within(await again.findByRole('group', { name: 'End of editing review' }))
        expect(review.getByText(/because their private-notes key is turned off/)).toHaveTextContent(`${off1.slice(0, 5)}…${off1.slice(-4)}`)
        fireEvent.click(review.getByRole('button', { name: 'Stop editing with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest
        expect(request.lines(undefined)).toContainEqual(['Also removed because their private-notes key is turned off', off1]); expect(request.lines(undefined)).toContainEqual(['Can no longer edit', reader])
    })
})

describe('Who can edit (a writer, a reader)', () => {
    it('a writer edits, sees who can edit, and has no owner action: no Share controls, no Delete', async () => {
        seal(reader, [owner], [owner]); show()
        expect(await screen.findByRole('button', { name: 'Unlock' })).toBeVisible()
        const part = await openShare()
        await waitFor(() => expect(part.getByText('can edit')).toBeVisible())
        expect(part.queryByRole('checkbox')).toBeNull(); expect(part.queryByRole('button', { name: 'Remove…' })).toBeNull(); expect(part.queryByRole('textbox')).toBeNull()
        expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        expect(screen.queryByRole('menuitem', { name: 'Delete note…' })).toBeNull()
    })
    it('a reader without the writer flag gets no Edit', async () => {
        seal(reader, [owner]); show()
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        expect(await screen.findByRole('heading', { name: 'Tuna tataki' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    })
})

// E2 review P2: a writer published a body nobody can decrypt (the realm checks only the header). Never a dead end.
describe('an unreadable latest version (E2 review P2)', () => {
    /** The note's body replaced by header-valid ciphertext that does not decrypt, published by `by`. */
    function sabotage(by: string) {
        const body = new Uint8Array(300).map((_, i) => (i * 37 + 11) & 255); body.set([1, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 2])
        note = { ...note, body, bodyBytes: body.length, bodyRevision: '2', actor: by }
    }
    async function unlocked() {
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        expect(await screen.findByText('The latest version of this note cannot be decrypted.')).toBeVisible()
    }
    it('the owner sees who published it, then stops that writer editing with a recovery Rotate that replaces the text with the notice, named in the review and the sheet', async () => {
        seal(owner, [reader], [reader]); sabotage(reader); show()
        await unlocked()
        expect(screen.getByText(new RegExp(`published by ${reader.slice(0, 5)}.*You can replace it`))).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Share' }))
        const part = within(await screen.findByRole('region', { name: 'Who can read' }))
        const toggle = await part.findByRole('checkbox', { name: 'Can edit' }); await waitFor(() => expect(toggle).toBeEnabled())
        fireEvent.click(toggle)
        expect(await part.findByText(/cannot be decrypted by anyone, so it cannot be encrypted again for a new key/)).toBeVisible(); expect(io.sign).not.toHaveBeenCalled()
        fireEvent.click(part.getByRole('button', { name: 'Replace the text and continue…' }))
        const review = within(await part.findByRole('group', { name: 'End of editing review' }))
        expect(review.getByText(/it cannot be decrypted by anyone\. In the new key its body is replaced by a short notice/)).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Stop editing with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(message.value.func).toBe('Rotate'); expect(request.lines(undefined)).toContainEqual(['Replaces the unreadable latest text', `body by ${reader} → a notice`])
        expect(request.lines(undefined)).toContainEqual(['Can no longer edit', reader])
    })
    it('with the owner’s encrypted draft of the note on this device, the draft replaces the unreadable text', async () => {
        seal(owner, [reader], [reader]); sabotage(reader)
        const scope = { chainId: golden.chainId, realm: NOTES_REALM, owner, noteId }
        const envelope = sealPrivateDraft(scope, 1n, 1n, publicKey, { title: 'Tuna tataki', body: 'My own draft of the recipe', mode: 1 })
        expect((await store.saveDraft(scope, '0', { kind: 'encrypted', envelope }, createDraftSession())).status).toBe('saved')
        show(); await unlocked()
        fireEvent.click(screen.getByRole('button', { name: 'Share' }))
        const part = within(await screen.findByRole('region', { name: 'Who can read' }))
        fireEvent.click(await part.findByRole('button', { name: 'Remove…' }))
        fireEvent.click(await part.findByRole('button', { name: 'Replace the text and continue…' }))
        const review = within(await part.findByRole('group', { name: 'Removal review' }))
        expect(review.getByText(/replaced by your draft of this note on this device/)).toBeVisible()
        fireEvent.click(review.getByRole('button', { name: 'Remove with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest
        expect(request.lines(undefined)).toContainEqual(['Replaces the unreadable latest text', `body by ${reader} → your draft on this device`])
        expect(JSON.stringify(request.prepare(undefined).msgs)).not.toContain('My own draft')
    })
    // E2 round-2 P3: one node's answer is never enough to offer replacing a text.
    it('a second verified node serving other bytes for the unreadable field: no replacement offered, only Try again', async () => {
        seal(owner, [reader], [reader]); sabotage(reader)
        nodes = ['https://rpc.one', 'https://rpc.two']; served = { 'https://rpc.two': { ...note, body: note.body!.map((b, i) => i > 20 ? b ^ 1 : b) } }
        show(); await unlocked()
        fireEvent.click(screen.getByRole('button', { name: 'Share' }))
        const part = within(await screen.findByRole('region', { name: 'Who can read' }))
        fireEvent.click(await part.findByRole('button', { name: 'Remove…' }))
        expect(await part.findByText(/answers about this note’s latest text disagree, so Memba does not offer to replace it/)).toBeVisible()
        expect(part.queryByRole('button', { name: 'Replace the text and continue…' })).toBeNull()
        // The nodes agree again (the lagging one caught up): the offer comes back.
        served = {}; fireEvent.click(part.getByRole('button', { name: 'Try again' }))
        expect(await part.findByRole('button', { name: 'Replace the text and continue…' })).toBeVisible(); expect(io.sign).not.toHaveBeenCalled()
    })
    it('with one node, a fresh read must return the same ciphertext; bytes changed before the replacement is prepared refuse it', async () => {
        seal(owner, [reader], [reader]); sabotage(reader); show(); await unlocked()
        fireEvent.click(screen.getByRole('button', { name: 'Share' }))
        const part = within(await screen.findByRole('region', { name: 'Who can read' }))
        fireEvent.click(await part.findByRole('button', { name: 'Remove…' }))
        const offer = await part.findByRole('button', { name: 'Replace the text and continue…' })
        // Another undecryptable body, same revision (what a node switching answers would look like): not the bytes confirmed.
        note = { ...note, body: note.body!.map((b, i) => i > 20 ? b ^ 2 : b) }
        fireEvent.click(offer)
        expect(await part.findByText(/answers about this note’s latest text disagree/)).toBeVisible()
        expect(part.queryByRole('group', { name: 'Removal review' })).toBeNull(); expect(io.sign).not.toHaveBeenCalled()
    })
    it('a reader is told who published it and that its owner can replace it; nothing is offered to them', async () => {
        seal(reader, [owner]); sabotage(reader); show()
        await unlocked()
        expect(screen.getByText(new RegExp(`published by ${reader.slice(0, 5)}.*Its owner can replace it`))).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    })
})

describe('Shared with me paging', () => {
    it('skips pages of only the account’s own notes and loads more on request', async () => {
        seal(reader, [owner])
        const read = client(), mine = { ...note, id: 'aa'.repeat(16), owner }, shared = (n: number) => ({ ...note, id: n.toString(16).padStart(32, '0') })
        vi.mocked(read.sharedWith).mockImplementation(async (_who: string, cursor = '') => cursor === '' ? { items: [mine], nextCursor: 'p2' }
            : cursor === 'p2' ? { items: [shared(1)], nextCursor: 'p3' } : { items: [shared(2)], nextCursor: '' })
        controller = createIdentityController(read, owner, createDraftSession())
        render(<nav aria-label="Notes list"><SharedWithMe controller={controller} client={read} owner={owner} selected={null} onOpen={() => {}} /></nav>)
        const list = within(screen.getByRole('navigation', { name: 'Notes list' }))
        await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(1))
        fireEvent.click(list.getByRole('button', { name: 'Show more' }))
        await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(2))
        expect(list.queryByRole('button', { name: 'Show more' })).toBeNull()
    })
})
