import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@noble/hashes/sha2.js'
import { bech32Encode } from '../../dao/realmAddress'
import type { NotesReadClient } from '../chain/client'
import type { IdentityChainState } from './controller'

// The real release switches and network allowlist (lib/notes/config.ts), read at import as a build reads them.
const network = vi.hoisted(() => ({ send: vi.fn(), unlock: vi.fn() }))
vi.mock('@noble/hashes/argon2.js', () => ({ argon2idAsync: async (secret: Uint8Array, salt: Uint8Array) => sha256(Uint8Array.from([...secret, ...salt])) }))
vi.mock('../crypto/signer', () => ({ requestNotesUnlock: (...args: unknown[]) => network.unlock(...args) }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500000000, doContractBroadcast: (...args: unknown[]) => network.send(...args), freshFeeForGasWanted: async () => 90000, assertFeeStillCovers: async () => {} }))
const RC1 = 'gno.land/r/samcrew/memba_notes_rc1', V1 = 'gno.land/r/samcrew/memba_notes_v1'
const bytes = new Uint8Array(20).fill(7), owner = bech32Encode('g', bytes)
const empty = (): IdentityChainState => ({ generation: 0n, active: false, publicKey: new Uint8Array(), keyOperationId: '', keyHeight: 0n, backup: null })
const disabled = { name: 'NotesChainError', code: 'disabled' }

async function load(flags: { chain?: boolean; encrypted?: boolean } = {}) {
  vi.stubEnv('VITE_ENABLE_NOTES', 'true')
  vi.stubEnv('VITE_ENABLE_NOTES_CHAIN', String(flags.chain ?? true))
  vi.stubEnv('VITE_ENABLE_NOTES_ENCRYPTED', String(flags.encrypted ?? true))
  vi.resetModules()
  const [{ NotesIdentityController }, { prepareIdentitySetupRequest }, { createDraftSession, createNotesStore }, { createNotesIntents }] = await Promise.all([
    import('./controller'), import('./request'), import('../drafts'), import('../intents')])
  function controller(chainId: string, realm: string, read = vi.fn(async () => empty())) {
    const session = createDraftSession()
    return { session, read, controller: new NotesIdentityController({ chainId, realm, address: owner, addressBytes: bytes, session, read, isCurrent: () => true }) }
  }
  function request(c: ReturnType<typeof controller>['controller'], session: ReturnType<typeof controller>['session'], chainId = 'onyx-1', realm = RC1) {
    const client = { chainId, realm, assertCurrent: () => {}, height: async () => '10',
      key: async () => ({ address: owner, generation: '0', active: false, publicKey: new Uint8Array(), operationId: '', height: '0' }), seedBackupRaw: async () => null,
    } as unknown as NotesReadClient
    const store = createNotesStore({ indexedDB: new IDBFactory() }), intents = createNotesIntents(store)
    return { store, intents, prepare: () => prepareIdentitySetupRequest({ controller: c, client, owner, caps: { registryUgnot: '1000000', backupUgnot: '1000000' }, intents, session, isWriteEnabled: () => true,
      quote: async input => ({ requestDigest: input.requestDigest, chainId: input.chainId, atHeight: input.height, expiresAtHeight: '20', expiresAtMs: Date.now() + 60000, source: 'bounded-estimate', estimatedDepositUgnot: '900000', maxDepositUgnot: '2000000', gasWanted: 60000000, networkFeeUgnot: 100000 }) }) }
  }
  return { controller, request }
}
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('private notes runtime gate (real switches)', () => {
  it('opens the identity lifecycle on onyx-1 with every switch on', async () => {
    const { controller } = await load(), s = controller('onyx-1', RC1)
    await s.controller.refresh(); expect(s.controller.getSnapshot().phase).toBe('empty')
    const output = await s.controller.prepareSetup('vault'); s.controller.confirmRecovery(output.phrase)
    const plan = s.controller.preparedPlan()
    s.read.mockResolvedValue({ generation: 1n, active: true, publicKey: plan.publicKey, keyOperationId: plan.operationId, keyHeight: 5n, backup: { revision: 1n, record: plan.backup, operationId: plan.operationId, height: 5n } })
    expect(await s.controller.confirmSetup()).toBe(true)
    expect(await s.controller.use(identity => identity.publicKey)).toEqual(plan.publicKey)
    s.controller.dispose()
  })
  it.each([
    ['gnoland-1 with every switch on', {}, 'gnoland-1', V1],
    ['onyx-1 with another realm', {}, 'onyx-1', V1],
    ['an unknown network', {}, 'test-chain-id', RC1],
    ['a prototype key', {}, '__proto__', RC1],
    ['a build without VITE_ENABLE_NOTES_ENCRYPTED', { encrypted: false }, 'onyx-1', RC1],
    ['a build without VITE_ENABLE_NOTES_CHAIN', { chain: false }, 'onyx-1', RC1],
  ] as const)('refuses every controller entry point on %s, before any read or wallet prompt', async (_name, flags, chainId, realm) => {
    const { controller } = await load(flags), s = controller(chainId, realm)
    for (const attempt of [() => s.controller.refresh(), () => s.controller.unlockStandard({}), () => s.controller.recover('abandon '.repeat(23) + 'art'),
      () => s.controller.prepareSetup('standard', {}), () => s.controller.prepareSetup('vault'), () => s.controller.use(() => 1), () => s.controller.confirmSetup()]) {
      await expect(attempt()).rejects.toMatchObject(disabled)
    }
    expect(() => s.controller.preparedPlan()).toThrow(expect.objectContaining(disabled))
    expect(s.read).not.toHaveBeenCalled(); expect(network.unlock).not.toHaveBeenCalled()
  })
  it('closes at runtime: the chain switch turned off between review and signature never opens the wallet', async () => {
    const { controller, request } = await load(), s = controller('onyx-1', RC1)
    const output = await s.controller.prepareSetup('vault'); s.controller.confirmRecovery(output.phrase)
    const r = request(s.controller, s.session), signing = await r.prepare()
    let opened = false
    network.send.mockImplementation(async (_messages, _memo, options) => { await options.beforeSign(); opened = true; return { hash: 'aa'.repeat(32) } })
    const driver = vi.fn(async () => { vi.stubEnv('VITE_ENABLE_NOTES_CHAIN', 'false'); return () => true })
    await expect(signing.send(undefined, driver)).rejects.toMatchObject(disabled)
    expect(driver).toHaveBeenCalledTimes(1); expect(opened).toBe(false)
    expect(() => s.controller.preparedPlan()).toThrow(expect.objectContaining(disabled))
    await r.store.close(); s.controller.dispose()
  })
  it('refuses a key setup request for another network, even with every switch on', async () => {
    const { controller, request } = await load(), s = controller('onyx-1', RC1)
    const output = await s.controller.prepareSetup('vault'); s.controller.confirmRecovery(output.phrase)
    const r = request(s.controller, s.session, 'gnoland-1', V1)
    await expect(r.prepare()).rejects.toMatchObject(disabled)
    expect(network.send).not.toHaveBeenCalled()
    await r.store.close(); s.controller.dispose()
  })
})
