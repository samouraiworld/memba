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
const publicKey = blob(golden.publicKeyBase64, 1216), readerKey = identityFromSeed(new Uint8Array(32).fill(3)).publicKey, noteId = 'cd'.repeat(16)
const key = (address: string, pk: Uint8Array) => ({ address, generation: '1', active: true, publicKey: pk, operationId: '11'.repeat(16), height: '5' })
let note: ChainNote, manifest: Uint8Array, controller: NotesIdentityController, store: NotesStore
/** A note of `noteOwner`, sealed for its owner and `readers`. */
function seal(noteOwner = owner, readers: string[] = []) {
    const keys: Record<string, Uint8Array> = { [owner]: publicKey, [reader]: readerKey }
    const sealed = prepareEncryptedEpoch({ chainId: golden.chainId, realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: readers.length ? 1 : 0, owner: noteOwner,
        recipients: [{ key: key(noteOwner, keys[noteOwner]), writer: true }, ...readers.map(who => ({ key: key(who, keys[who]), writer: false }))], title: 'Tuna tataki', body: 'Sear **30 seconds** a side.' })
    manifest = sealed.manifest
    note = { id: noteId, owner: noteOwner, pendingOwner: '', ownerGeneration: '1', mode: sealed.mode, stateRevision: '3', titleRevision: '1', bodyRevision: '1', epoch: '1', title: sealed.title, body: sealed.body,
        commitment: sealed.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '22'.repeat(16), actor: noteOwner, height: '9', bodyBytes: sealed.body.length }
}
function client(): NotesReadClient {
    const entries = () => decodeManifest(manifest, 1)
    return { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10',
        config: async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }),
        key: async (who: string) => who === owner ? key(owner, publicKey) : who === reader ? key(reader, readerKey) : { address: who, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' },
        seedBackupRaw: async () => ({ mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(hexToBytes(golden.publicKeyHashHex)), op_id: '11'.repeat(16), actor: owner, height: '5', record: golden.recordBase64 }),
        note: async () => note, noteMetadata: async () => note, readersRaw: async () => entries().map(entry => bech32Encode('g', entry.address)),
        wrapRaw: async (_id: string, _epoch: string, who: string) => {
            const entry = entries().find(e => bech32Encode('g', e.address) === who)
            return entry ? { address: who, epoch: '1', writer: entry.writer, generation: '1', public_key_hash: encode64(sha256(who === owner ? publicKey : readerKey)), wrap: encode64(entry.wrap) } : null
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
    vi.clearAllMocks(); io.open = true; controller = undefined as unknown as NotesIdentityController; store = createNotesStore({ indexedDB: new IDBFactory() }); seal()
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
        expect(part.getByText('Unlock this note to add or remove readers.')).toBeVisible()
        expect(part.queryByRole('textbox')).toBeNull(); expect(part.getByRole('button', { name: 'Remove…' })).toBeDisabled()
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

describe('Who can read (a reader)', () => {
    it('shows the list without any control', async () => {
        seal(reader, [owner]); show()
        const part = await openShare(false)
        await waitFor(() => expect(part.getByText('owner')).toBeVisible())
        expect(part.queryByRole('button', { name: 'Remove…' })).toBeNull(); expect(part.queryByRole('textbox')).toBeNull()
        expect(part.queryByText('Unlock this note to add or remove readers.')).toBeNull()
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
