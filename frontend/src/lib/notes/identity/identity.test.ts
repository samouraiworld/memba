import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { bech32Encode } from '../../dao/realmAddress'
import { createDraftSession } from '../drafts'
import { blob, NOTES_REALM } from '../chain/schema'
import { parseBackup } from '../crypto/backup'
import { NotesIdentityController } from './controller'
import type { IdentityChainState } from './controller'
import { addressBytes, identitySetupMessages } from './chain'
import { readRecoveryFile, recoveryEntropy, recoveryPhrase } from './recovery'
import golden from './__fixtures__/backup-standard.json'

// Lifecycle tests use a cheap deterministic KDF; actual Argon2/AEAD vectors are in crypto/identity.test.ts.
const dependencies = vi.hoisted(() => ({ kdf: vi.fn(), unlock: vi.fn() }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: (...args: unknown[]) => dependencies.kdf(...args) }))
vi.mock('../crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => dependencies.unlock(...args) }))
const pk = () => blob(golden.publicKeyBase64, 1216), backup = () => blob(golden.recordBase64, 365)
const who = bech32Encode('g', hexToBytes(golden.addressHex))
function registered(): IdentityChainState { return { generation: 1n, active: true, publicKey: pk(), keyOperationId: '11'.repeat(16), keyHeight: 1n, backup: { revision: 1n, record: backup(), operationId: '11'.repeat(16), height: 1n } } }
function empty(): IdentityChainState { return { generation: 0n, active: false, publicKey: new Uint8Array(), keyOperationId: '', keyHeight: 0n, backup: null } }
function setup(initial = registered()) {
  let chain = initial
  const session = createDraftSession(), read = vi.fn(async () => structuredClone(chain))
  const controller = new NotesIdentityController({ chainId: golden.chainId, realm: NOTES_REALM, address: who, addressBytes: hexToBytes(golden.addressHex), session, read, isCurrent: () => true })
  return { controller, session, read, setChain: (next: IdentityChainState) => { chain = next } }
}
beforeEach(() => {
  vi.clearAllMocks()
  dependencies.kdf.mockImplementation(async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])))
  dependencies.unlock.mockImplementation(async () => ({ ikm: hexToBytes(golden.materialHex), publicKey: new Uint8Array(33) }))
})
describe('Notes recovery encoding', () => {
  it('uses 24-word English BIP39 checksum as entropy, never a PBKDF2 wallet seed', () => {
    const phrase = 'abandon '.repeat(23) + 'art'
    expect(recoveryPhrase(new Uint8Array(32))).toBe(phrase)
    expect(bytesToHex(recoveryEntropy(phrase))).toBe('00'.repeat(32))
    expect(() => recoveryEntropy('abandon '.repeat(24).trim())).toThrow()
    expect(() => recoveryEntropy('abandon '.repeat(11) + 'about')).toThrow()
    expect(() => recoveryEntropy('x'.repeat(513))).toThrow()
  })
  it('has exact canonical address bytes and rejects a mistyped wallet address', () => {
    expect(bytesToHex(addressBytes(who))).toBe(golden.addressHex)
    expect(() => addressBytes(who.slice(0, -1) + 'x')).toThrow()
  })
})
describe('RAM-only identity lifecycle', () => {
  it('reads without wallet access and unlocks the real Standard golden, with key copies erased', async () => {
    const s = setup(); await s.controller.refresh()
    expect(s.controller.getSnapshot()).toMatchObject({ phase: 'locked', mode: 'standard', generation: '1' })
    expect(dependencies.unlock).not.toHaveBeenCalled()
    await s.controller.unlockStandard({})
    expect(s.controller.getSnapshot().phase).toBe('unlocked')
    let exposed: Uint8Array = new Uint8Array()
    await s.controller.use(identity => { exposed = identity.secretKey; expect(bytesToHex(identity.publicKey)).toBe(bytesToHex(pk())) })
    expect(exposed.every(byte => byte === 0)).toBe(true)
    s.controller.lock(); expect(s.controller.getSnapshot().phase).toBe('locked')
    await expect(s.controller.use(() => {})).rejects.toThrow()
  })
  it('erases an in-flight key immediately on account/network abort and discards its result', async () => {
    const s = setup(); await s.controller.unlockStandard({})
    let exposed: Uint8Array = new Uint8Array(), finish!: () => void
    const used = s.controller.use(async identity => { exposed = identity.secretKey; await new Promise<void>(resolve => { finish = resolve }) })
    await vi.waitFor(() => expect(exposed.length).toBeGreaterThan(0))
    s.session.invalidate(); expect(exposed.every(byte => byte === 0)).toBe(true)
    finish(); await expect(used).rejects.toThrow()
  })
  it('does not activate a seed returned after lock or accept replacement keys silently', async () => {
    const s = setup()
    dependencies.unlock.mockImplementationOnce(async () => { s.controller.lock(); return { ikm: hexToBytes(golden.materialHex) } })
    await expect(s.controller.unlockStandard({})).rejects.toThrow(); expect(s.controller.getSnapshot().phase).toBe('locked')
    s.setChain({ ...registered(), publicKey: new Uint8Array(1216).fill(2) })
    await expect(s.controller.refresh()).rejects.toThrow()
    expect(s.controller.getSnapshot().phase).not.toBe('unlocked')
  })
  it('prepares a new identity only explicitly, requires recovery confirmation, and waits for both receipts', async () => {
    const s = setup(empty()), output = await s.controller.prepareSetup('standard', {})
    expect(dependencies.unlock).toHaveBeenCalledTimes(2)
    expect(s.controller.getSnapshot()).toMatchObject({ phase: 'prepared', recoveryConfirmed: false })
    expect(() => s.controller.preparedPlan()).toThrow()
    s.controller.confirmRecovery(output.phrase)
    const plan = s.controller.preparedPlan(), messages = identitySetupMessages(plan, who, golden.chainId, { registryUgnot: '1000000', backupUgnot: '500000' })
    expect(messages.map(message => message.value.func)).toEqual(['RegisterKey', 'SetSeedBackup'])
    expect(messages[0].value.args).toEqual(['xwing-v1', '0', expect.any(String), expect.any(String)])
    expect((messages[1].value.args as string[])[0]).toBe('0')
    expect(await s.controller.confirmSetup()).toBe(false)
    s.setChain({ generation: 1n, active: true, publicKey: plan.publicKey, keyOperationId: plan.operationId, keyHeight: 10n, backup: { revision: 1n, record: plan.backup, operationId: 'ff'.repeat(16), height: 10n } })
    expect(await s.controller.confirmSetup()).toBe(false)
    s.setChain({ generation: 1n, active: true, publicKey: plan.publicKey, keyOperationId: plan.operationId, keyHeight: 10n, backup: { revision: 1n, record: plan.backup, operationId: plan.operationId, height: 10n } })
    expect(await s.controller.confirmSetup()).toBe(true)
    expect(s.controller.getSnapshot().phase).toBe('unlocked')
    s.controller.lock(); await s.controller.recover(output.phrase, output.exportText)
    expect(s.controller.getSnapshot().phase).toBe('unlocked')
    expect(readRecoveryFile(output.exportText)).toHaveLength(1)
  })
  it('refuses nondeterministic Standard signatures without creating a fallback identity', async () => {
    const s = setup(empty())
    dependencies.unlock.mockResolvedValueOnce({ ikm: new Uint8Array(64).fill(1) }).mockResolvedValueOnce({ ikm: new Uint8Array(64).fill(2) })
    await expect(s.controller.prepareSetup('standard', {})).rejects.toThrow('signature')
    expect(s.controller.getSnapshot().phase).toBe('empty'); expect(dependencies.kdf).not.toHaveBeenCalled()
  })
  it('renews only the prepared operation and recovers the same identity with the original export', async () => {
    const s = setup(empty()), output = await s.controller.prepareSetup('standard', {})
    expect(() => s.controller.renewPreparedOperation('11'.repeat(16))).toThrow()
    s.controller.confirmRecovery(output.phrase)
    const before = s.controller.preparedPlan(), next = s.controller.renewPreparedOperation(before.operationId)
    expect(next.operationId).toMatch(/^[a-f0-9]{32}$/); expect(next.operationId).not.toBe(before.operationId)
    expect(next).toEqual({ ...before, operationId: next.operationId })
    expect(s.controller.getSnapshot().recoveryConfirmed).toBe(true)
    expect(() => s.controller.renewPreparedOperation(before.operationId)).toThrow()
    expect(dependencies.unlock).toHaveBeenCalledTimes(2)
    s.setChain({ generation: next.generation, active: true, publicKey: next.publicKey, keyOperationId: next.operationId, keyHeight: 10n, backup: { revision: 1n, record: next.backup, operationId: next.operationId, height: 10n } })
    expect(await s.controller.confirmSetup()).toBe(true)
    s.controller.lock(); await s.controller.recover(output.phrase, output.exportText)
    expect(s.controller.getSnapshot().phase).toBe('unlocked')
    expect(await s.controller.use(identity => identity.publicKey)).toEqual(before.publicKey)
    s.controller.dispose()
  })
  it('refuses renewal while busy or after lock, and fails closed on repeated or zero random IDs', async () => {
    const s = setup(empty()), output = await s.controller.prepareSetup('vault'); s.controller.confirmRecovery(output.phrase)
    const before = s.controller.preparedPlan()
    let finish!: (state: IdentityChainState) => void
    s.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const refreshing = s.controller.refresh()
    expect(() => s.controller.renewPreparedOperation(before.operationId)).toThrow()
    finish(empty()); await refreshing
    for (const bytes of [new Uint8Array(16), hexToBytes(before.operationId)]) {
      const rng = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { (array as Uint8Array).set(bytes); return array })
      try { expect(() => s.controller.renewPreparedOperation(before.operationId)).toThrow(); expect(s.controller.preparedPlan()).toEqual(before) }
      finally { rng.mockRestore() }
    }
    s.controller.lock(); expect(() => s.controller.renewPreparedOperation(before.operationId)).toThrow()
    s.controller.dispose()
  })
  it('migrates to an independent Vault identity and retains an encrypted archival generation', async () => {
    const s = setup(); await s.controller.unlockStandard({})
    const output = await s.controller.prepareSetup('vault')
    expect(output.migrationPartial).toBe(true)
    s.controller.confirmRecovery(output.phrase)
    const plan = s.controller.preparedPlan()
    expect(plan.generation).toBe(2n); expect(bytesToHex(plan.publicKey)).not.toBe(bytesToHex(pk()))
    const records = readRecoveryFile(output.exportText)
    expect(records.map(value => parseBackup(value.backup).binding.generation)).toEqual([2n, 1n])
    expect(parseBackup(plan.backup).binding.mode).toBe('vault')
    expect(() => identitySetupMessages({ ...plan, generation: 3n }, who, golden.chainId, { registryUgnot: '0', backupUgnot: '0' })).toThrow()
  })
  it('fails closed for missing backups, invalid recovery files and disposed controllers', async () => {
    const s = setup({ ...registered(), backup: null }); await s.controller.refresh()
    await expect(s.controller.unlockStandard({})).rejects.toThrow()
    await expect(s.controller.recover(recoveryPhrase(new Uint8Array(32)), '{}')).rejects.toThrow()
    s.controller.dispose(); await expect(s.controller.prepareSetup('vault')).rejects.toThrow()
    expect(dependencies.unlock).not.toHaveBeenCalled()
  })
})
