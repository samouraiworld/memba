import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../../../lib/dao/realmAddress'
import { createDraftSession, createNotesStore, type NotesStore } from '../../../../lib/notes/drafts'
import type { NotesReadClient } from '../../../../lib/notes/chain/client'
import { blob, encode64 } from '../../../../lib/notes/chain/schema'
import { NOTES_REALM } from '../../../../lib/notes/chain/__fixtures__/deployment'
import { createIdentityController } from '../../../../lib/notes/privateNotes'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import type { SignRequest } from '../../../sign/signer'
import { SignerContext, type SignerApi } from '../../../sign/signerContext'
import golden from '../../../../lib/notes/identity/__fixtures__/backup-standard.json'
import { PrivateNotesPanel } from './PrivateNotesPanel'

// Cheap deterministic KDF (real Argon2/AEAD vectors live in crypto/identity.test.ts); Adena's unlock signature is mocked.
const io = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn(), send: vi.fn(), open: true }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => io.kdf(...args) }))
vi.mock('../../../../lib/notes/crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => io.unlock(...args) }))
vi.mock('../../../../lib/grc20', async original => ({ ...await original<typeof import('../../../../lib/grc20')>(),
    doContractBroadcast: (...args: unknown[]) => io.send(...args), freshFeeForGasWanted: async () => 72000, assertFeeStillCovers: async () => {} }))
vi.mock('../../../../lib/dao/packageStatus', () => ({ abciQueryText: async () => '"100ugnot"' }))
vi.mock('../../../../lib/rpcFallback', () => ({ getRpcUrlsInOrder: () => ['https://rpc.invalid'] }))
// The fixture network is no release network: the test opens the private gate for it (gate.test.ts runs the real switches).
vi.mock('../../../../lib/notes/config', async original => ({ ...await original<typeof import('../../../../lib/notes/config')>(),
    privateNotesDeployment: (chainId: string) => io.open && chainId === 'test-chain-id' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null,
    notesDeployment: (chainId: string) => chainId === 'test-chain-id' ? { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 } : null }))

const owner = bech32Encode('g', hexToBytes(golden.addressHex))
type Chain = { generation: string; active: boolean; publicKey: Uint8Array; operationId: string; height: string; backup: { record: string; opId: string; hash: Uint8Array; generation?: string } | null }
const empty = (): Chain => ({ generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0', backup: null })
const goldenChain = (): Chain => ({ generation: '1', active: true, publicKey: blob(golden.publicKeyBase64, 1216), operationId: '11'.repeat(16), height: '5', backup: { record: golden.recordBase64, opId: '11'.repeat(16), hash: hexToBytes(golden.publicKeyHashHex) } })
let chain: Chain, store: NotesStore, controller: NotesIdentityController, requests: SignRequest[]
function client(): NotesReadClient {
    return { chainId: golden.chainId, realm: NOTES_REALM, assertCurrent: () => {}, height: async () => '10',
        key: async () => ({ address: owner, generation: chain.generation, active: chain.active, publicKey: chain.publicKey, operationId: chain.operationId, height: chain.height }),
        seedBackupRaw: async () => chain.backup && { mode: 1, suite: 'xwing-v1', generation: chain.backup.generation ?? chain.generation, revision: '1', public_key_hash: encode64(chain.backup.hash), op_id: chain.backup.opId, actor: owner, height: chain.height, record: chain.backup.record },
    } as unknown as NotesReadClient
}
function show(walletChainId?: string, version = 0) {
    const reader = client()
    controller ??= createIdentityController(reader, owner, createDraftSession())
    const signer: SignerApi = { sign: req => { requests.push(req); return true }, pending: [], notices: [], unread: 0, markRead: () => {}, version }
    // StrictMode, as the dev server runs it: effects mount, unmount and mount again.
    return render(<StrictMode><SignerContext.Provider value={signer}><PrivateNotesPanel controller={controller} client={reader} store={store} owner={owner} requestSession={createDraftSession()} walletChainId={walletChainId} /></SignerContext.Provider></StrictMode>)
}
/** The OS signing driver, without Adena: approve, broadcast (the chain applies both calls), verify, settle. */
async function approve(request: SignRequest, outcome: 'land' | 'wallet-unknown') {
    io.send.mockImplementationOnce(async (messages: { value: { args: string[] } }[], _memo: string, options: { beforeSign(): Promise<unknown> }) => {
        await options.beforeSign()
        if (outcome === 'wallet-unknown') throw new Error('Adena closed')
        const [registry, backup] = messages.map(message => message.value.args), op = bytesToHex(blob(registry[3], 16)), pk = blob(registry[2], 1216)
        chain = { generation: '1', active: true, publicKey: pk, operationId: op, height: '11', backup: { record: backup[1], opId: op, hash: sha256(pk) } }
        return { hash: 'AA'.repeat(32) }
    })
    await act(async () => {
        try {
            const sent = await request.send(undefined, async () => () => true)
            request.onSettled?.(await request.verify!(undefined, sent.hash, undefined) === true ? 'confirmed' : 'submitted', undefined)
        } catch { request.onSettled?.('unknown', undefined) }
    })
}
beforeEach(() => {
    vi.clearAllMocks(); io.open = true; chain = empty(); requests = []; controller = undefined as unknown as NotesIdentityController
    store = createNotesStore({ indexedDB: new IDBFactory() })
    io.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
    io.unlock.mockImplementation(async () => ({ ikm: hexToBytes(golden.materialHex), publicKey: new Uint8Array(33) }))
    URL.createObjectURL = vi.fn(() => 'blob:recovery'); URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(async () => { cleanup(); controller?.dispose(); vi.restoreAllMocks(); await store.close() })

describe('private notes key panel', () => {
    it('renders nothing while the private gate is closed for this network', async () => {
        io.open = false
        const view = show()
        expect(view.container).toBeEmptyDOMElement()
        expect(io.unlock).not.toHaveBeenCalled()
    })
    it('sets up a key in one guided sheet: cost once, two unlock signatures, phrase shown then re-entered, file, one transaction', async () => {
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        expect(screen.getByRole('dialog', { name: 'Set up private notes' })).toHaveTextContent('≈ 1.45 GNOT storage deposit')
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('At most 1.8 GNOT, written in the transaction. Network fee about 0.072 GNOT'))
        expect(io.unlock).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        const words = await screen.findByRole('list', { name: 'Recovery phrase' })
        expect(io.unlock).toHaveBeenCalledTimes(2)
        const phrase = [...words.querySelectorAll('li')].map(item => item.textContent).join(' ')
        expect(phrase.split(' ')).toHaveLength(24)
        expect(screen.getByRole('button', { name: 'I wrote it down' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Download recovery file' }))
        const file = await (vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).text()
        expect(JSON.parse(file)).toMatchObject({ type: 'memba-notes-recovery', version: 1 }); expect(file).not.toContain(phrase.split(' ')[0] + ' ' + phrase.split(' ')[1])
        fireEvent.click(screen.getByRole('button', { name: 'I wrote it down' }))
        const field = screen.getByLabelText(/The 24 words/)
        fireEvent.change(field, { target: { value: phrase.split(' ').reverse().join(' ') } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        expect(screen.getByRole('alert')).toHaveTextContent('do not match')
        fireEvent.change(field, { target: { value: `  ${phrase.replace(/ /g, '\n')}  ` } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        const msgs = requests[0].prepare(undefined).msgs.map(message => message.value as { func: string; max_deposit: string })
        expect(msgs.map(message => [message.func, message.max_deposit])).toEqual([['RegisterKey', '600000ugnot'], ['SetSeedBackup', '1200000ugnot']])
        expect(requests[0].lines(undefined)).toContainEqual(['Estimated storage deposit (ugnot)', '1450000'])
        await approve(requests[0], 'land')
        expect(await screen.findByRole('heading', { name: 'Private notes are ready' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        expect(await screen.findByText('Unlocked in this window.', { selector: 'b' })).toBeVisible()
        // Lock zeroes the key; the recovery phrase and file then open it again without Adena.
        const seed = (controller as unknown as { seed: Uint8Array }).seed
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
        expect(seed.every(byte => byte === 0)).toBe(true)
        expect(screen.getByRole('status')).toHaveTextContent('Locked. Your key was cleared from this window.')
        io.unlock.mockClear()
        fireEvent.click(await screen.findByRole('button', { name: 'Use recovery phrase' }))
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: phrase } })
        fireEvent.change(screen.getByLabelText('Recovery file'), { target: { files: [new File([file], 'recovery.json', { type: 'application/json' })] } })
        const sheet = within(screen.getByRole('dialog', { name: 'Use your recovery phrase' }))
        await waitFor(() => expect(sheet.getByRole('button', { name: 'Unlock' })).toBeEnabled())
        fireEvent.click(sheet.getByRole('button', { name: 'Unlock' }))
        expect(await screen.findByText('Unlocked in this window.', { selector: 'b' })).toBeVisible()
        expect(io.unlock).not.toHaveBeenCalled()
    })
    it('refuses a wallet that signs differently twice, registering nothing', async () => {
        io.unlock.mockResolvedValueOnce({ ikm: new Uint8Array(64).fill(1) }).mockResolvedValueOnce({ ikm: new Uint8Array(64).fill(2) })
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Adena gave two different signatures')
        expect(controller.getSnapshot().phase).toBe('empty'); expect(requests).toHaveLength(0)
    })
    it('unlocks an existing key only on an explicit click, never while Adena is on another network', async () => {
        chain = goldenChain()
        const view = show('gnoland-1')
        expect(await screen.findByText(/Your private key is locked/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Adena is on gnoland-1')
        view.unmount(); show()
        await screen.findByText(/Sign it only on memba.club/)
        expect(io.unlock).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
        expect(await screen.findByText('Unlocked in this window.', { selector: 'b' })).toBeVisible()
        expect(io.unlock).toHaveBeenCalledTimes(1)
        // Closing the page clears the key at once.
        const seed = (controller as unknown as { seed: Uint8Array }).seed
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(seed.every(byte => byte === 0)).toBe(true); expect(controller.getSnapshot().phase).toBe('locked')
    })
    it('keeps an unknown setup on hold after a reload and confirms it from the chain, never signing again', async () => {
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        const phrase = [...(await screen.findByRole('list', { name: 'Recovery phrase' })).querySelectorAll('li')].map(item => item.textContent).join(' ')
        fireEvent.click(screen.getByRole('button', { name: 'Download recovery file' })); fireEvent.click(screen.getByRole('button', { name: 'I wrote it down' }))
        fireEvent.change(screen.getByLabelText(/The 24 words/), { target: { value: phrase } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'wallet-unknown')
        // Reload: a new window and controller, the receipt is all that is left.
        cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
        show()
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        // The transaction did land: the exact registry and backup receipts confirm it, with no wallet prompt.
        const plan = requests[0].prepare(undefined).msgs.map(message => (message.value as { args: string[] }).args), op = bytesToHex(blob(plan[0][3], 16)), pk = blob(plan[0][2], 1216)
        chain = { generation: '1', active: true, publicKey: pk, operationId: op, height: '11', backup: { record: plan[1][1], opId: op, hash: sha256(pk) } }
        io.unlock.mockClear()
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
        expect(await screen.findByText(/Your private key is locked/)).toBeVisible()
        expect(io.unlock).not.toHaveBeenCalled(); expect(io.send).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1)
    })
    it('shows a key changed outside Memba as read only', async () => {
        // Another app re-keyed the shared registry (generation 2); Notes still holds the generation 1 backup.
        chain = { ...goldenChain(), generation: '2', publicKey: new Uint8Array(1216).fill(9) }; chain.backup!.generation = '1'
        show()
        expect(await screen.findByText('Your private key changed outside Memba.')).toBeVisible()
        for (const name of ['Unlock', 'Set up private notes', 'Use recovery phrase']) expect(screen.queryByRole('button', { name })).toBeNull()
        expect(io.unlock).not.toHaveBeenCalled()
    })
})
