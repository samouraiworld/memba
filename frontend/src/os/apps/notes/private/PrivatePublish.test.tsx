import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { decodeManifest } from '../../../../lib/notes/crypto/manifest'
import { openPrivateDraft } from '../../../../lib/notes/private/localDraft'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { createDraftSession, createNotesStore, type DraftRecord, type NotesStore } from '../../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { blob, encode64 } from '../../../../lib/notes/chain/schema'
import { NOTES_REALM } from '../../../../lib/notes/chain/__fixtures__/deployment'
import { createIdentityController } from '../../../../lib/notes/privateNotes'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import golden from '../../../../lib/notes/identity/__fixtures__/backup-standard.json'
import simulation from '../../../../lib/notes/chain/__fixtures__/simulate-onyx.json'
import type { SignRequest } from '../../../sign/signer'
import { PublicPublish, type PrivateCreate } from '../PublicPublish'
import { PrivateChoice, PrivateReview } from './PrivatePublish'

// The real key controller unlocked from the real Standard backup (only the KDF and Adena's signature are mocked), the
// real sealer and request builder; the signature sheet, the network fee and the balance read are stubs.
const io = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn(), sign: vi.fn(), open: true, keyActive: true, balance: null as string | null, simulate: null as (() => Promise<Uint8Array>) | null }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => io.kdf(...args) }))
vi.mock('../../../../lib/notes/crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => io.unlock(...args) }))
vi.mock('../../../sign/signerContext', () => ({ useSigner: () => ({ sign: io.sign }) }))
vi.mock('../../../../lib/grc20', async original => ({ ...await original<typeof import('../../../../lib/grc20')>(), freshFeeForGasWanted: async (gas: number) => Math.ceil(gas * 1.2 / 1000),
    assertFeeStillCovers: async () => {}, doContractBroadcast: async (_msgs: unknown, _memo: string, options: { beforeSign(): Promise<unknown> }) => { await options.beforeSign(); return { hash: 'aa'.repeat(32) } } }))
vi.mock('../../../../lib/dao/packageStatus', () => ({ abciQueryText: async (_ctx: unknown, path: string) => {
    if (path === 'params/vm:p:storage_price') return '"100ugnot"'
    if (path.startsWith('bank/balances/') && io.balance !== null) return JSON.stringify(io.balance)
    throw new Error('offline')
} }))
vi.mock('../../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../../lib/notes/config')>(),
    notesDeployment: (chainId: string) => chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null,
    deploymentRealm: () => NOTES_REALM,
    privateNotesDeployment: (chainId: string) => io.open && chainId === 'test-chain-id' ? { realm: NOTES_REALM, version: 1 } : null }))

const owner = bech32Encode('g', hexToBytes(golden.addressHex)), publicKey = blob(golden.publicKeyBase64, 1216), noteId = 'cd'.repeat(16)
const draft: DraftRecord = { schema: 1, scope: { chainId: golden.chainId, realm: NOTES_REALM, owner, noteId }, localRevision: '1', updatedAt: 1, payload: { kind: 'public', title: 'Field guide', body: 'Saved content, never public' } }
const backup = { mode: 1, suite: 'xwing-v1', generation: '1', revision: '1', public_key_hash: encode64(hexToBytes(golden.publicKeyHashHex)), op_id: '11'.repeat(16), actor: owner, height: '5', record: golden.recordBase64 }
function client(): NotesReadClient {
    return { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10', note: async () => null,
        config: async () => ({ realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }),
        key: async () => io.keyActive ? { address: owner, generation: '1', active: true, publicKey, operationId: '11'.repeat(16), height: '5' } : { address: owner, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' },
        seedBackupRaw: async () => io.keyActive ? backup : null, simulateRaw: async () => { if (io.simulate) return io.simulate(); throw new Error('offline') },
    } as unknown as NotesReadClient
}
let controller: NotesIdentityController, store: NotesStore
/** As publicNative binds it: the slot of this window's controller, client and account. */
function slot(reader: NotesReadClient, openPanel = vi.fn()): PrivateCreate {
    const bound = { controller, client: reader, store, owner }
    return { Choice: props => <PrivateChoice {...bound} {...props} onSetUp={openPanel} />, Review: props => <PrivateReview {...bound} {...props} /> }
}
async function review(privateCreate?: PrivateCreate, reader = client()) {
    expect((await store.saveDraft(draft.scope, '0', draft.payload, createDraftSession().capture())).status).toBe('saved')
    render(<PublicPublish draft={draft} client={reader} store={store} privateCreate={privateCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    return await screen.findByRole('heading', { name: 'Publish “Field guide”?' })
}
const privateRadio = () => screen.getByRole('radio', { name: /Private · encrypted, only you/ })
beforeEach(() => {
    store = createNotesStore({ indexedDB: new IDBFactory() })
    vi.clearAllMocks(); io.open = true; io.keyActive = true; io.balance = null; io.simulate = null; io.sign.mockReturnValue(true)
    io.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
    io.unlock.mockImplementation(async () => ({ ikm: hexToBytes(golden.materialHex), publicKey: new Uint8Array(33) }))
})
afterEach(async () => { cleanup(); controller?.dispose(); await store?.close() })

describe('the private choice in the publish sheet', () => {
    it('stays "Not available yet" where the private chunk is not loaded', async () => {
        await review()
        expect(privateRadio()).toBeDisabled(); expect(screen.getByText('Not available yet')).toBeVisible()
    })
    it('opens for a registered key, locked or not, with no wallet prompt', async () => {
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        expect(screen.getByText('Encrypted in this browser before it is sent')).toBeVisible(); expect(io.unlock).not.toHaveBeenCalled()
    })
    it('asks to set up private notes first, and links to the Private notes panel', async () => {
        io.keyActive = false
        const reader = client(), openPanel = vi.fn(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader, openPanel))
        expect(await screen.findByText('Set up private notes first')).toBeVisible(); expect(privateRadio()).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Open Private notes' })); expect(openPanel).toHaveBeenCalledOnce()
    })
    it('stays closed when the gate is closed for this network', async () => {
        io.open = false
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        expect(screen.getByText('Not available on this network')).toBeVisible(); expect(privateRadio()).toBeDisabled()
    })
})

describe('publishing privately', () => {
    it('unlocks only on click, encrypts here, says what stays public and what it costs, then hands a ciphertext-only request to the signature sheet', async () => {
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        fireEvent.click(privateRadio())
        expect(await screen.findByText('Unlock your private key to encrypt this note.')).toBeVisible(); expect(io.unlock).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
        expect(await screen.findByText(/Your address as the owner, the encrypted sizes \(title 71 bytes, text 87 bytes\)/)).toBeVisible()
        const sheet = screen.getByRole('dialog', { name: 'Publish privately' })
        expect(sheet).toHaveTextContent('≈ 1.6791 GNOT locked as storage deposit, plus a 0.1 GNOT publication fee that is not returned. Deleting the note later returns about half of the deposit; the rest stays locked.')
        expect(sheet).toHaveTextContent('At most 2.1 GNOT, written in the transaction. Network fee at most 0.0912 GNOT; Adena usually charges less.')
        expect(sheet).toHaveTextContent('Once published, your draft on this device is replaced by an encrypted copy.')
        expect(io.unlock).toHaveBeenCalledOnce(); expect(io.sign).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Publish privately with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, [message] = request.prepare(undefined).msgs
        expect(request.title).toBe('Publish private note')
        expect(message.value).toMatchObject({ func: 'CreateNote', pkg_path: NOTES_REALM, send: '100000ugnot', max_deposit: '2100000ugnot' })
        const text = JSON.stringify(message) + JSON.stringify(request.lines(undefined))
        for (const secret of ['Saved content', encode64(new TextEncoder().encode(draft.payload.kind === 'public' ? draft.payload.body : '')), 'Field guide']) expect(text).not.toContain(secret)
        expect(request.lines(undefined)).toContainEqual(['Estimated storage deposit', '1.6791 GNOT'])
    })
    it('refuses a balance below the written maximum (cap + fees), even when it covers the estimate', async () => {
        io.balance = '2000000ugnot'
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        fireEvent.click(privateRadio()); fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        // ≈ 1.6791 + 0.1 + 0.0912 = 1.8703 GNOT is covered; the maximum 2.1 + 0.1 + 0.0912 is not.
        expect(await screen.findByText(/This can cost up to 2\.2912 GNOT; your balance is 2 GNOT\./)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Publish privately with Adena' })).toBeDisabled(); expect(io.sign).not.toHaveBeenCalled()
    })
    it('refuses, before the signature sheet, a note the node says needs more storage than the cap', async () => {
        io.simulate = async () => blob(simulation.overCap.resultBase64, 4096)
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        fireEvent.click(privateRadio()); fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Publish privately with Adena' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Publish privately with Adena' }))
        expect(await screen.findByText('This note needs more storage than Memba can approve. Nothing was sent. Your text is kept.')).toBeVisible()
        expect(io.sign).not.toHaveBeenCalled()
    })
    it('drops the encrypted copy and asks to unlock again when the key locks before signing', async () => {
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        fireEvent.click(privateRadio()); fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Publish privately with Adena' })).toBeEnabled())
        act(() => controller.lock())
        expect(await screen.findByText('Unlock your private key to encrypt this note.')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Publish privately with Adena' })).toBeDisabled(); expect(io.sign).not.toHaveBeenCalled()
    })
    it('replaces the plaintext draft it was published from with an encrypted copy once the publication is confirmed', async () => {
        const reader = client(); controller = createIdentityController(reader, owner, createDraftSession())
        await review(slot(reader))
        await waitFor(() => expect(privateRadio()).toBeEnabled())
        fireEvent.click(privateRadio()); fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Publish privately with Adena' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Publish privately with Adena' }))
        await waitFor(() => expect(io.sign).toHaveBeenCalledOnce())
        const request = io.sign.mock.calls[0][0] as SignRequest, { args } = request.prepare(undefined).msgs[0].value
        await request.send(undefined, async () => () => true)
        const manifest = blob(args[4], 41570), entry = decodeManifest(manifest, 1)[0]
        const confirmed = { id: noteId, owner, pendingOwner: '', ownerGeneration: '1', mode: 0 as const, stateRevision: '1', titleRevision: '1', bodyRevision: '1', epoch: '1', title: blob(args[2], 231), body: blob(args[3], 135223),
            commitment: blob(args[5], 32), deleted: false, listed: false, createdHeight: '11', operationId: bytesToHex(blob(args[7], 16)), actor: owner, height: '11' }
        Object.assign(reader, { note: async () => confirmed, noteMetadata: async () => confirmed, readersRaw: async () => [owner],
            wrapRaw: async () => ({ address: owner, epoch: '1', writer: true, generation: '1', public_key_hash: encode64(entry.publicKeyHash), wrap: encode64(entry.wrap) }) })
        expect(await request.verify!(undefined, 'aa'.repeat(32), undefined)).toBe(true)
        const record = (await store.getDraft(draft.scope))!
        expect(record.payload.kind).toBe('encrypted'); expect(record.localRevision).toBe('2')
        const envelope = (record.payload as { envelope: Uint8Array }).envelope
        expect(new TextDecoder().decode(envelope)).not.toContain('Saved content')
        expect(await controller.use(identity => openPrivateDraft(draft.scope, 2n, 1n, identity, envelope))).toEqual({ title: 'Field guide', body: 'Saved content, never public', mode: 0,
            base: { stateRevision: '1', epoch: '1', ownerGeneration: '1', titleRevision: '1', bodyRevision: '1' } })
    })
})
