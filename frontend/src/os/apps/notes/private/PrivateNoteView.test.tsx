import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { createDraftSession } from '../../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { blob, encode64, type ChainNote } from '../../../../lib/notes/chain/schema'
import { NOTES_REALM } from '../../../../lib/notes/chain/__fixtures__/deployment'
import { identityFromSeed } from '../../../../lib/notes/crypto/identity'
import { decodeManifest } from '../../../../lib/notes/crypto/manifest'
import { createIdentityController } from '../../../../lib/notes/privateNotes'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import { sealPrivateNote } from '../../../../lib/notes/private/__fixtures__/seal'
import golden from '../../../../lib/notes/identity/__fixtures__/backup-standard.json'
import { PrivateNoteView } from './PrivateNoteView'
import { SharedWithMe } from './SharedWithMe'

// The real key controller, unlocked from the real Standard backup (only the KDF and Adena's signature are mocked),
// and a note sealed with real X-Wing wraps and content AEAD for that key.
const io = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn(), open: true }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => io.kdf(...args) }))
vi.mock('../../../../lib/notes/crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => io.unlock(...args) }))
vi.mock('../../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../../lib/notes/config')>(),
    privateNotesDeployment: (chainId: string) => io.open && chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null }))
// The Markdown worker is not part of this test: the preview shows the decrypted body as text.
vi.mock('../../../../lib/notes/render', () => ({ createNotesRenderer: () => ({ render: async (body: string) => ({ kind: 'text', text: body, reason: 'timeout', truncated: false }), dispose: () => {} }) }))

const owner = bech32Encode('g', hexToBytes(golden.addressHex)), author = bech32Encode('g', new Uint8Array(20).fill(5))
const publicKey = blob(golden.publicKeyBase64, 1216), noteId = 'cd'.repeat(16)
const registry = (key: Uint8Array, address = owner) => ({ address, generation: '1', active: true, publicKey: key, operationId: '11'.repeat(16), height: '5' })
let wrap: Record<string, unknown> | null, note: ChainNote, controller: NotesIdentityController
/** Shared by `author` with this account (mode 1), sealed for `readerKey` (this account's key unless another is given). */
function seal(readerKey = publicKey) {
    const authorKey = identityFromSeed(new Uint8Array(32).fill(3)).publicKey
    const sealed = sealPrivateNote({ chainId: golden.chainId, realm: NOTES_REALM, noteId, epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 1, owner: author,
        recipients: [{ key: registry(authorKey, author), writer: true }, { key: registry(readerKey), writer: false }], title: 'Tuna tataki', body: 'Sear **30 seconds** a side.' })
    note = { id: noteId, owner: author, pendingOwner: '', ownerGeneration: '1', mode: 1, stateRevision: '3', titleRevision: '1', bodyRevision: '1', epoch: '1', title: sealed.title, body: sealed.body,
        commitment: sealed.commitment, deleted: false, listed: false, createdHeight: '1', operationId: '22'.repeat(16), actor: author, height: '9', bodyBytes: sealed.body.length }
    const entry = decodeManifest(sealed.manifest, 1)[1]
    wrap = { address: owner, epoch: '1', writer: false, generation: '1', public_key_hash: encode64(sha256(readerKey)), wrap: encode64(entry.wrap) }
}
function client(): NotesReadClient {
    return { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10',
        key: async () => ({ address: owner, generation: '1', active: true, publicKey, operationId: '11'.repeat(16), height: '5' }),
        seedBackupRaw: async () => ({ mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(hexToBytes(golden.publicKeyHashHex)), op_id: '11'.repeat(16), actor: owner, height: '5', record: golden.recordBase64 }),
        note: async () => note, noteMetadata: async () => ({ ...note, body: undefined }), wrapRaw: vi.fn(async () => wrap),
        epochMetadataRaw: async () => ({ items: [{ epoch: '1', commitment: encode64(note.commitment), revealed_key: '' }], next_cursor: '1' }),
        sharedWith: vi.fn(async () => ({ items: [{ ...note, body: undefined }], nextCursor: '' })),
    } as unknown as NotesReadClient
}
function show(reader = client()) {
    controller ??= createIdentityController(reader, owner, createDraftSession())
    return render(<StrictMode><PrivateNoteView note={note} controller={controller} client={reader} owner={owner} />
        <nav aria-label="Notes list"><SharedWithMe controller={controller} client={reader} owner={owner} selected={null} onOpen={() => {}} /></nav></StrictMode>)
}
beforeEach(() => {
    vi.clearAllMocks(); io.open = true; controller = undefined as unknown as NotesIdentityController; seal()
    io.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
    io.unlock.mockImplementation(async () => ({ ikm: hexToBytes(golden.materialHex), publicKey: new Uint8Array(33) }))
})
afterEach(() => { cleanup(); controller?.dispose() })
const list = () => screen.getByRole('navigation', { name: 'Notes list' })

describe('reading a private note', () => {
    it('stays locked until an explicit Unlock, then decrypts title and body read only; Lock clears them from the page', async () => {
        show()
        expect(await screen.findByText('This note is encrypted.')).toBeVisible()
        expect(io.unlock).not.toHaveBeenCalled(); expect(document.body).not.toHaveTextContent('Tuna tataki')
        // The list knows a note was shared, not its title.
        await waitFor(() => expect(list()).toHaveTextContent('Private note'))
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
        expect(await screen.findByRole('heading', { name: 'Tuna tataki' })).toBeVisible()
        expect(await screen.findByText('Sear **30 seconds** a side.')).toBeVisible()
        expect(io.unlock).toHaveBeenCalledTimes(1)
        for (const name of ['Edit', 'Publish', 'Share']) expect(screen.queryByRole('button', { name })).toBeNull()
        await waitFor(() => expect(list()).toHaveTextContent('Tuna tataki'))
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
        expect(await screen.findByText('This note is encrypted.')).toBeVisible()
        expect(document.body).not.toHaveTextContent('Tuna tataki'); expect(document.body).not.toHaveTextContent('30 seconds')
        expect(list()).toHaveTextContent('Private note')
    })
    it('clears the plaintext when the window\'s key ends (account or network switch, Shell lock, page hide)', async () => {
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        expect(await screen.findByRole('heading', { name: 'Tuna tataki' })).toBeVisible()
        act(() => controller.dispose())
        await waitFor(() => expect(document.body).not.toHaveTextContent('Tuna tataki'))
        expect(document.body).not.toHaveTextContent('30 seconds')
    })
    it('says no access, without any wallet prompt, when this account has no envelope', async () => {
        wrap = null
        show()
        expect(await screen.findByText('You don’t have access to this private note.')).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull(); expect(io.unlock).not.toHaveBeenCalled()
    })
    it('says the current key cannot open a note sealed for another key of this account', async () => {
        seal(identityFromSeed(new Uint8Array(32).fill(4)).publicKey)
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        expect(await screen.findByText('Your current key cannot open this note.')).toBeVisible()
        expect(document.body).not.toHaveTextContent('Tuna tataki')
        // The list keeps the placeholder: this key cannot open the title either.
        await waitFor(() => expect(list()).toHaveTextContent('Private note'))
    })
    it('shows the plain placeholder and nothing to unlock when private notes are off for this network', async () => {
        io.open = false
        show()
        expect(await screen.findByText(/Opening private notes is not available in this version/)).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull(); expect(list()).toBeEmptyDOMElement()
        expect(io.unlock).not.toHaveBeenCalled()
    })
})
