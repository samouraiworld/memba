import { beforeAll, describe, expect, it, vi } from 'vitest'
import { argon2id, argon2idAsync } from '@noble/hashes/argon2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bech32Encode } from '../../dao/realmAddress'
import { concat, equalBytes, randomBytes, u8, utf8 } from './bytes'
import { identityFromSeed, newIdentitySeed, verifiedIdentity } from './identity'
import { sealBackup, openBackup, parseBackup, recoverIdentity } from './backup'
import type { BackupBinding } from './backup'
import { sealField, openField } from './content'
import { wrapForReader, unwrapForReader } from './wrap'

vi.mock('@noble/hashes/argon2.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@noble/hashes/argon2.js')>()
  return { ...actual, argon2idAsync: vi.fn(actual.argon2idAsync) }
})
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const network = { chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1' }
const seed = new Uint8Array(32).fill(21), identity = identityFromSeed(seed)
const binding: BackupBinding = { ...network, mode: 'standard', address: new Uint8Array(20).fill(7), generation: 1n, publicKeyHash: sha256(identity.publicKey) }
const walletMaterial = new Uint8Array(64).fill(51)
const vaultSeed = new Uint8Array(32).fill(29), vaultIdentity = identityFromSeed(vaultSeed)
const vaultBinding: BackupBinding = { ...binding, mode: 'vault', generation: 2n, publicKeyHash: sha256(vaultIdentity.publicKey) }
const recoveryMaterial = new Uint8Array(32).fill(82)
let standardRecord: Uint8Array, vaultRecord: Uint8Array

beforeAll(async () => {
  standardRecord = await sealBackup(seed, walletMaterial, binding)
  const pending = sealBackup(vaultSeed, recoveryMaterial, vaultBinding)
  await expect(sealBackup(vaultSeed, recoveryMaterial, vaultBinding)).rejects.toMatchObject({ code: 'busy' })
  vaultRecord = await pending
})

describe('Versioned identity backup and fail-closed recovery', () => {
  it('matches RFC9106 Argon2id section5.3 before using the production profile', () => {
    const actual = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), { m: 32, t: 3, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4) })
    expect(hex(actual)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659')
  })
  it('recovers Standard and Vault with independent derivations and preserves caller secrets', async () => {
    expect(await recoverIdentity(standardRecord, walletMaterial, binding, identity.publicKey)).toEqual(seed)
    expect(await recoverIdentity(vaultRecord, recoveryMaterial, vaultBinding, vaultIdentity.publicKey)).toEqual(vaultSeed)
    expect(seed).toEqual(new Uint8Array(32).fill(21)); expect(recoveryMaterial).toEqual(new Uint8Array(32).fill(82))
    expect(standardRecord.length).toBe(215); expect(vaultRecord.length).toBe(215)
    expect(parseBackup(vaultRecord).binding.generation).toBe(2n)
  })
  it('rejects costs, unknown formats, duplicates/trailing data and identity substitutions before Argon2', async () => {
    const derive = vi.mocked(argon2idAsync); derive.mockClear()
    for (const [offset, value] of [[0, 0], [4, 2], [5, 2], [6, 1], [7, 0], [8, 255], [12, 255], [16, 255], [33, 255]]) {
      const changed = vaultRecord.slice(); changed[offset] = value
      await expect(openBackup(changed, recoveryMaterial, vaultBinding)).rejects.toThrow()
    }
    for (const bad of [vaultRecord.slice(0, -1), concat(vaultRecord, u8(0)), new Uint8Array(366)]) await expect(openBackup(bad, recoveryMaterial, vaultBinding)).rejects.toThrow()
    for (const change of [{ mode: 'standard' as const }, { chainId: 'onyx' }, { realm: network.realm + '2' }, { address: randomBytes(20) }, { generation: 3n }, { publicKeyHash: randomBytes(32) }]) await expect(openBackup(vaultRecord, recoveryMaterial, { ...vaultBinding, ...change })).rejects.toThrow()
    expect(derive).not.toHaveBeenCalled()
  })
  it('uses all mutable backup metadata and rejects a changed wallet signature instead of replacing identity', async () => {
    const changedSalt = standardRecord.slice(); changedSalt[17] ^= 1
    await expect(openBackup(changedSalt, walletMaterial, binding)).rejects.toMatchObject({ code: 'decrypt' })
    await expect(recoverIdentity(standardRecord, randomBytes(64), binding, identity.publicKey)).rejects.toMatchObject({ code: 'decrypt' })
    await expect(recoverIdentity(standardRecord, walletMaterial, binding, vaultIdentity.publicKey)).rejects.toMatchObject({ code: 'identity' })
    await expect(sealBackup(vaultSeed, walletMaterial, binding)).rejects.toMatchObject({ code: 'identity' })
    expect(verifiedIdentity(seed, identity.publicKey).publicKey).toEqual(identity.publicKey)
    expect(() => verifiedIdentity(seed, vaultIdentity.publicKey)).toThrow()
  })
  it('snapshots record and caller context before asynchronous recovery', async () => {
    const record = standardRecord.slice(), expected = { ...binding, address: binding.address.slice(), publicKeyHash: binding.publicKeyHash.slice() }
    const recovery = openBackup(record, walletMaterial, expected)
    record.fill(0); expected.address.fill(255); expected.publicKeyHash.fill(0)
    expect(await recovery).toEqual(seed)
  })
  it('enforces exact maxima, nonzero generation and a full realm path', async () => {
    const longest: BackupBinding = { ...binding, chainId: 'n'.repeat(64), realm: 'gno.land/r/' + 'r'.repeat(117) }
    expect((await sealBackup(seed, walletMaterial, longest)).length).toBe(365)
    for (const change of [{ chainId: 'n'.repeat(65) }, { realm: 'gno.land/r/' + 'r'.repeat(118) }, { realm: 'gno.land/r/' }, { generation: 0n }]) await expect(sealBackup(seed, walletMaterial, { ...binding, ...change })).rejects.toThrow()
  })
  it('protects future epochs only after creating an independent identity and rotating the note key', async () => {
    const recoveredHistoricalSeed = await recoverIdentity(standardRecord, walletMaterial, binding, identity.publicKey)
    const attacker = identityFromSeed(recoveredHistoricalSeed), epoch = { ...network, noteId: randomBytes(16), epoch: 1 }
    const reader = bech32Encode('g', binding.address), oldCtx = { ...epoch, reader, generation: 1n }, oldKey = randomBytes(32)
    const oldWrap = wrapForReader(oldKey, identity.publicKey, oldCtx)
    expect(unwrapForReader(oldWrap, attacker.secretKey, identity.publicKey, oldCtx)).toEqual(oldKey)
    const futureKey = randomBytes(32), futureCtx = { ...oldCtx, epoch: 2 }
    // Rewrapping the same identity leaves the historical recovery attack intact.
    expect(unwrapForReader(wrapForReader(futureKey, identity.publicKey, futureCtx), attacker.secretKey, identity.publicKey, futureCtx)).toEqual(futureKey)
    const migrated = { ...futureCtx, generation: 2n }, wrap = wrapForReader(futureKey, vaultIdentity.publicKey, migrated)
    expect(() => unwrapForReader(wrap, attacker.secretKey, vaultIdentity.publicKey, migrated)).toThrow()
    const field = { ...epoch, epoch: 2, field: 'body' as const, fieldRevision: 1n }, blob = sealField(futureKey, field, utf8('new private epoch'))
    expect(() => openField(oldKey, field, blob)).toThrow()
    expect(equalBytes(newIdentitySeed(), newIdentitySeed())).toBe(false)
  })
})
