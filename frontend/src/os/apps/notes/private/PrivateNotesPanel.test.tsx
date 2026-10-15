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
import { NOTES_REGISTRY } from '../../../../lib/notes/chain/schema'
import { NotesIntents } from '../../../../lib/notes/intents'
import { NotesCryptoError } from '../../../../lib/notes/crypto/bytes'
import { createIdentityController } from '../../../../lib/notes/privateNotes'
import type { NotesIdentityController } from '../../../../lib/notes/identity/controller'
import type { SignRequest } from '../../../sign/signer'
import { SignerContext, type SignerApi } from '../../../sign/signerContext'
import golden from '../../../../lib/notes/identity/__fixtures__/backup-standard.json'
import { IDENTITY_SETUP_LABEL } from '../../../../lib/notes/identity/request'
import { PrivateNotesPanel } from './PrivateNotesPanel'

// Cheap deterministic KDF (real Argon2/AEAD vectors live in crypto/identity.test.ts); Adena's unlock signature is mocked.
const io = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn(), send: vi.fn(), open: true, balance: '"5000000ugnot"' }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => io.kdf(...args) }))
vi.mock('../../../../lib/notes/crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => io.unlock(...args) }))
vi.mock('../../../../lib/grc20', async original => ({ ...await original<typeof import('../../../../lib/grc20')>(),
    doContractBroadcast: (...args: unknown[]) => io.send(...args), freshFeeForGasWanted: async () => 72000, assertFeeStillCovers: async () => {} }))
vi.mock('../../../../lib/dao/packageStatus', () => ({ abciQueryText: async (_c: unknown, path: string) => path.startsWith('bank/balances/') ? io.balance : '"100ugnot"' }))
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
function show(walletChainId?: string, version = 0, pending: SignerApi['pending'] = []) {
    const reader = client()
    controller ??= createIdentityController(reader, owner, createDraftSession())
    const signer: SignerApi = { sign: req => { requests.push(req); return true }, pending, notices: [], unread: 0, markRead: () => {}, version }
    // StrictMode, as the dev server runs it: effects mount, unmount and mount again.
    return render(<StrictMode><SignerContext.Provider value={signer}><PrivateNotesPanel controller={controller} client={reader} store={store} owner={owner} requestSession={createDraftSession()} walletChainId={walletChainId} /></SignerContext.Provider></StrictMode>)
}
/** The OS signing driver, without Adena: approve, broadcast (the chain applies both calls), verify, settle. */
type Msgs = { value: { args: string[] } }[]
/**
 * The realm, for one atomic RegisterKey + SetSeedBackup: both are compare-and-swap calls (registry generation, backup
 * revision), and a refused call reverts the whole transaction.
 */
function land(messages: Msgs): void {
    const [registry, backup] = messages.map(message => message.value.args), op = bytesToHex(blob(registry[3], 16)), pk = blob(registry[2], 1216)
    if (registry[1] !== chain.generation) throw new Error('enckeys: stale generation')
    if (backup[0] !== (chain.backup ? '1' : '0')) throw new Error('notes: stale backup revision')
    chain = { generation: String(BigInt(chain.generation) + 1n), active: true, publicKey: pk, operationId: op, height: String(11 + Number(chain.generation)), backup: { record: backup[1], opId: op, hash: sha256(pk) } }
}
async function approve(request: SignRequest, outcome: 'land' | 'sent' | 'wallet-unknown' | 'refused') {
    io.send.mockImplementationOnce(async (messages: Msgs, _memo: string, options: { beforeSign(): Promise<unknown> }) => {
        await options.beforeSign()
        if (outcome === 'refused' || outcome === 'wallet-unknown') throw new Error(outcome === 'refused' ? 'refused by the node' : 'Adena closed')
        if (outcome === 'land') land(messages)
        return { hash: 'AA'.repeat(32) }
    })
    await act(async () => {
        try {
            const sent = await request.send(undefined, async () => () => true)
            request.onSettled?.(await request.verify!(undefined, sent.hash, undefined) === true ? 'confirmed' : 'submitted', undefined)
        } catch { request.onSettled?.(outcome === 'refused' ? 'failed' : 'unknown', undefined) }
    })
}
/** Intro to review: two unlock signatures, the phrase shown, the file, the phrase entered again. Returns the phrase. */
async function toReview(open = true): Promise<string> {
    if (open) fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continue in Adena' }))
    const phrase = [...(await screen.findByRole('list', { name: 'Recovery phrase' })).querySelectorAll('li')].map(item => item.textContent).join(' ')
    fireEvent.click(screen.getByRole('button', { name: 'Download recovery file' })); fireEvent.click(screen.getByRole('button', { name: 'I wrote it down' }))
    fireEvent.change(screen.getByLabelText(/The 24 words/), { target: { value: phrase } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('button', { name: 'Set up with Adena' })
    return phrase
}
/** Another device set this account up: generation 1 under another operation (real backup material, not this device's). */
const elsewhere = (): Chain => ({ ...goldenChain(), operationId: '22'.repeat(16), height: '30', backup: { ...goldenChain().backup!, opId: '22'.repeat(16) } })
beforeEach(() => {
    vi.clearAllMocks(); io.open = true; io.balance = '"5000000ugnot"'; chain = empty(); requests = []; controller = undefined as unknown as NotesIdentityController
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
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('At most 1.8 GNOT, written in the transaction. Network fee at most 0.072 GNOT'))
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
        // A reply that does not verify (wrong network, malformed) is not called a mismatch.
        expect(controller.getSnapshot().phase).toBe('empty'); expect(requests).toHaveLength(0)
        // A reply that does not verify (wrong network, malformed) is not called a mismatch.
        io.unlock.mockRejectedValueOnce(new NotesCryptoError('signature'))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        expect(await screen.findByText(/signature could not be checked/)).toBeVisible()
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
        expect(screen.queryByRole('button', { name: 'Set up private notes' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Set up again' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull()
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

describe('private notes key panel, after review', () => {
    it('refuses before any signature when the balance cannot pay the maximum deposit plus the fee', async () => {
        io.balance = '"1800000ugnot"'
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Setting up needs up to 1.872 GNOT (deposit and network fee); your balance is 1.8 GNOT. Nothing was signed.')
        expect(io.unlock).not.toHaveBeenCalled(); expect(controller.getSnapshot().phase).toBe('empty')
    })
    it('says why "I wrote it down" waits, and names each recovery file by account, time and generation', async () => {
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        await screen.findByRole('list', { name: 'Recovery phrase' })
        expect(screen.getByText('Download the recovery file first.')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Download recovery file' }))
        expect(screen.queryByText('Download the recovery file first.')).toBeNull(); expect(screen.getByText(/If the download did not start/)).toBeVisible()
        expect((HTMLAnchorElement.prototype.click as unknown as { mock: { contexts: HTMLAnchorElement[] } }).mock.contexts[0].download).toMatch(/^memba-notes-recovery-test-chain-id-g1qmylf54cwze5-\d{8}-\d{6}-gen1\.json$/)
    })
    it('lets the member stop waiting for Adena during the unlock signatures, registering nothing', async () => {
        io.unlock.mockImplementation(() => new Promise(() => {}))
        show()
        fireEvent.click(await screen.findByRole('button', { name: 'Set up private notes' }))
        fireEvent.click(screen.getByRole('button', { name: 'Continue in Adena' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting' }))
        expect(screen.getByRole('alert')).toHaveTextContent('Stopped waiting. Nothing was registered.')
        expect(screen.getByRole('button', { name: 'Continue in Adena' })).toBeEnabled(); expect(requests).toHaveLength(0)
    })
    it('after a refusal Adena may have sent, explains the unknown result instead of offering a retry, and settles it once another device sets up', async () => {
        show()
        await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'refused')
        // The sheet closes: no "did not take effect", no retry that the saved receipt would refuse.
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        expect(screen.queryByText(/did not take effect/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Set up private notes' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Set up again' })).toBeNull()
        // The member sets up from another device: generation 1 went to another operation, so this one provably never applied.
        cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController; chain = elsewhere()
        show()
        expect(await screen.findByText(/Your private key is locked/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
        expect(screen.getByRole('status')).toHaveTextContent('An earlier key setup from this device did not take effect')
        const [receipt] = await new NotesIntents(store).list({ chainId: golden.chainId, realm: NOTES_REGISTRY, owner })
        expect(receipt.phase).toBe('failed')
        expect(io.send).toHaveBeenCalledTimes(1)
    })
    it('stops blocking a receipt the chain has moved past, without deciding it failed', async () => {
        show()
        await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'wallet-unknown')
        cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
        // Generation 2: whether this setup took generation 1 earlier no longer matters, it can never apply now.
        chain = { ...elsewhere(), generation: '2', active: false, publicKey: new Uint8Array(), backup: null }
        show()
        expect(await screen.findByText(/turned off outside Memba/)).toBeVisible()
        expect(screen.queryByText('The result of your key setup is not known yet.')).toBeNull()
        const [receipt] = await new NotesIntents(store).list({ chainId: golden.chainId, realm: NOTES_REGISTRY, owner })
        expect(receipt.phase).toBe('unknown')
    })
})
describe('setting up again while a first setup may still land', () => {
    /** A first setup whose result is unknown, then a reload: returns the first transaction's messages. */
    async function unknownFirst(): Promise<Msgs> {
        show(); await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'wallet-unknown')
        cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
        show()
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        return requests[0].prepare(undefined).msgs as unknown as Msgs
    }
    async function acknowledge() {
        fireEvent.click(screen.getByRole('button', { name: 'Set up again…' }))
        const button = screen.getByRole('button', { name: 'Set up again' })
        expect(button).toBeDisabled(); expect(screen.getByText(/Your first setup may still go through/)).toBeVisible()
        fireEvent.click(screen.getByRole('checkbox', { name: /keep my first recovery phrase and file/ })); fireEvent.click(button)
        await screen.findByRole('dialog', { name: 'Set up private notes' })
    }
    const receipts = () => new NotesIntents(store).list({ chainId: golden.chainId, realm: NOTES_REGISTRY, owner })
    it('is never offered on its own: only after an explicit, acknowledged choice, with a new operation', async () => {
        await unknownFirst()
        expect(screen.queryByRole('button', { name: 'Set up again' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Set up again…' })).toBeVisible()
        expect(io.unlock).toHaveBeenCalledTimes(2)
    })
    it('the new setup lands; a late copy of the first is refused by the realm and its receipt settles as failed', async () => {
        const first = await unknownFirst()
        await acknowledge()
        await toReview(false)
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(2))
        const second = requests[1].prepare(undefined).msgs.map(message => (message.value as { args: string[] }).args[3])
        expect(second[0]).not.toBe((first[0].value.args)[3])
        await approve(requests[1], 'land')
        expect(await screen.findByRole('heading', { name: 'Private notes are ready' })).toBeVisible()
        const winner = chain.operationId
        expect(() => land(first)).toThrow('stale generation')
        expect(chain.operationId).toBe(winner)
        fireEvent.click(screen.getByRole('button', { name: 'Done' }))
        await waitFor(async () => expect((await receipts()).map(r => [r.operationId === winner, r.phase, r.superseded ?? false]).sort()).toEqual([[false, 'failed', true], [true, 'confirmed', false]]))
        expect(screen.queryByText(/Your first key setup took effect/)).toBeNull()
    })
    it('the first setup lands meanwhile; the new one is refused before the wallet and the first recovery material is named', async () => {
        const first = await unknownFirst()
        await acknowledge()
        await toReview(false)
        land(first)
        io.unlock.mockClear()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('this new key was discarded. Nothing was sent.')
        expect(requests).toHaveLength(1); expect(io.send).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
        expect(await screen.findByText('Your first key setup took effect.')).toBeVisible()
        expect(screen.getByText(/recovery phrase and file from that first setup are the ones that open this key/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled(); expect(io.unlock).not.toHaveBeenCalled()
        expect((await receipts())[0]).toMatchObject({ phase: 'confirmed', superseded: true })
    })
    it('waits while a setup was just sent or the signing driver still holds one, and restarts a same-session setup at the intro', async () => {
        show(); await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'sent')
        expect(await screen.findByText('Your key setup was sent.')).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Set up again…' })).toBeNull()
        // A minute later it may be offered, unless the driver still holds a setup (Adena open, or verifying).
        const later = Date.now() + 61_000, now = vi.spyOn(Date, 'now').mockImplementation(() => later)
        try {
            cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
            show(undefined, 0, [{ id: 1, label: IDENTITY_SETUP_LABEL }])
            expect(await screen.findByText('Your key setup was sent.')).toBeVisible()
            expect(screen.queryByRole('button', { name: 'Set up again…' })).toBeNull()
            cleanup(); controller.dispose(); controller = undefined as unknown as NotesIdentityController
            show()
            expect(await screen.findByRole('button', { name: 'Set up again…' })).toBeVisible()
        } finally { now.mockRestore() }
    })
    it('treats a setup hidden while Adena still holds it as in flight until its request settles', async () => {
        show(); await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        // The driver sent it to Adena, which has not answered: the receipt is saved, nothing is verified yet.
        let answer: ((error: Error) => void) | null = null
        io.send.mockImplementationOnce(async (_messages: Msgs, _memo: string, options: { beforeSign(): Promise<unknown> }) => {
            await options.beforeSign(); return new Promise((_resolve, reject) => { answer = reject })
        })
        const sent = requests[0].send(undefined, async () => () => true).catch(() => requests[0].onSettled?.('unknown', undefined))
        await waitFor(() => expect(answer).not.toBeNull())
        fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Set up again…' })).toBeNull()
        // Adena closes without an answer: the request settles, and the explicit choice becomes available.
        await act(async () => { answer!(new Error('Adena closed')); await sent })
        expect(await screen.findByRole('button', { name: 'Set up again…' })).toBeVisible()
    })
    it('drops the first attempt\'s prepared key when setting up again in the same session', async () => {
        show(); await toReview()
        fireEvent.click(screen.getByRole('button', { name: 'Set up with Adena' }))
        await waitFor(() => expect(requests).toHaveLength(1))
        await approve(requests[0], 'wallet-unknown')
        expect(await screen.findByText('The result of your key setup is not known yet.')).toBeVisible()
        expect(controller.getSnapshot()).toMatchObject({ phase: 'prepared', recoveryConfirmed: true })
        await acknowledge()
        expect(screen.getByRole('heading', { name: 'Set up private notes' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Set up with Adena' })).toBeNull(); expect(controller.getSnapshot().phase).toBe('empty')
    })
})
