import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bech32Encode } from '../../dao/realmAddress'
import type { AminoMsg } from '../../grc20'
import type { NotesReadClient } from '../chain/client'
import { blob, encode64 } from '../chain/schema'
import { NOTES_REALM } from '../chain/__fixtures__/deployment'
import { readSimulation, unsignedCallTx } from '../chain/simulate'
import simulation from '../chain/__fixtures__/simulate-onyx.json'
import { identityFromSeed } from '../crypto/identity'
import { prepareEncryptedEpoch } from './engine'
import { privateNoteMessage } from './messages'
import { privateNoteBudget, privateNoteQuote } from './quote'

const network = vi.hoisted(() => ({ price: vi.fn(), fee: vi.fn() }))
vi.mock('../../dao/packageStatus', () => ({ abciQueryText: (...args: unknown[]) => network.price(...args) }))
vi.mock('../../grc20', () => ({ MAX_GAS_WANTED: 500_000_000, freshFeeForGasWanted: (...args: unknown[]) => network.fee(...args) }))
const owner = bech32Encode('g', new Uint8Array(20).fill(1)), chainId = 'test-chain'
const identity = identityFromSeed(new Uint8Array(32).fill(8)); identity.secretKey.fill(0)
const key = { address: owner, generation: '1', active: true, publicKey: identity.publicKey, operationId: '33'.repeat(16), height: '9' }
const config = { realm: NOTES_REALM, admin: owner, pendingAdmin: '', treasury: owner, createFeeUgnot: '100000', paused: false }
/** A private CreateNote exactly as Memba sends it: real X-Wing envelope and content AEAD, 40 B title. */
function create(bodyBytes: number, cap = '0'): AminoMsg {
  const prepared = prepareEncryptedEpoch({ chainId, realm: NOTES_REALM, noteId: '11'.repeat(16), epoch: 1, titleRevision: 1n, bodyRevision: 1n, mode: 0, owner,
    recipients: [{ key, writer: true }], title: 't'.repeat(40), body: 'b'.repeat(bodyBytes) })
  return privateNoteMessage({ chainId, caller: owner, noteId: '11'.repeat(16), operationId: '22'.repeat(16), action: { kind: 'create', prepared, maxFeeUgnot: '100000' } }, NOTES_REALM, cap, { note: null, epoch: null, config })
}
const synthetic = (title: number, body: number, envelopes: number): AminoMsg => ({ type: 'vm/MsgCall', value: { caller: owner, send: '100000ugnot', pkg_path: NOTES_REALM, func: 'CreateNote',
  args: ['', '0', encode64(new Uint8Array(title)), encode64(new Uint8Array(body)), encode64(new Uint8Array(2 + 1299 * envelopes)), encode64(new Uint8Array(32)), '100000', ''], max_deposit: '0ugnot' } })
beforeEach(() => { vi.clearAllMocks(); network.price.mockResolvedValue('"100ugnot"'); network.fee.mockImplementation(async (gas: number) => Math.ceil(gas * 1.2 / 1000)) })

describe('private create quote: bounded fallback against the M0 keeper rows', () => {
  // private-small-ops-m0-2026-10-15.md row 2: ciphertext sizes, measured deposit, keeper gas.
  it.each([
    [1024, 1143, 1_784_800, 44_700_000],
    [2048, 2231, 1_891_200, 44_900_000],
    [4096, 4407, 2_111_200, 44_800_000],
  ])('a %i B body seals to M0 sizes and its estimate covers the measured deposit closely', (bodyBytes, ciphertext, measured, keeperGas) => {
    const message = create(bodyBytes), budget = privateNoteBudget(message)
    expect(blob(message.value.args[2], 231)).toHaveLength(99); expect(blob(message.value.args[3], 135223)).toHaveLength(ciphertext)
    expect(blob(message.value.args[4], 41570)).toHaveLength(1301)
    expect(Number(budget.estimatedDepositUgnot)).toBeGreaterThanOrEqual(measured); expect(Number(budget.estimatedDepositUgnot)).toBeLessThan(measured * 1.01)
    expect(Number(budget.suggestedCapUgnot)).toBeGreaterThanOrEqual(measured * 1.2); expect(Number(budget.suggestedCapUgnot) % 100_000).toBe(0)
    expect(budget.gasWanted).toBeGreaterThanOrEqual(keeperGas * 1.5); expect(budget.gasWanted).toBeLessThanOrEqual(100_000_000)
  })
  it('names the figures the review shows for a 1 KB note', () => {
    expect(privateNoteBudget(create(1024))).toEqual({ gasWanted: 78_000_000, estimatedDepositUgnot: '1787500', suggestedCapUgnot: '2200000' })
  })
  it.each([
    ['create1max (10-08)', synthetic(231, 135223, 1), 15_206_500, 43_700_000],
    ['create32max (10-08)', synthetic(231, 135223, 32), 26_412_800, 348_940_469],
  ])('covers %s within the 500 M gas ceiling', (_name, message, measured, gas) => {
    const budget = privateNoteBudget(message)
    expect(Number(budget.estimatedDepositUgnot)).toBeGreaterThanOrEqual(measured); expect(Number(budget.suggestedCapUgnot)).toBeGreaterThan(measured * 1.2)
    expect(budget.gasWanted).toBeGreaterThan(gas); expect(budget.gasWanted).toBeLessThanOrEqual(500_000_000)
  })
  it('refuses another function, another realm, a malformed envelope list or commitment', () => {
    const other = synthetic(99, 1143, 1); other.value.func = 'Commit'
    const realm = synthetic(99, 1143, 1); realm.value.pkg_path = 'gno.land/r/samcrew/enckeys_v1'
    const envelope = synthetic(99, 1143, 1); envelope.value.args[4] = encode64(new Uint8Array(1300))
    const commitment = synthetic(99, 1143, 1); commitment.value.args[5] = encode64(new Uint8Array(31))
    for (const message of [other, realm, envelope, commitment]) expect(() => privateNoteBudget(message)).toThrow()
  })
})

describe('simulation (`.app/simulate`)', () => {
  it('encodes the unsigned transaction byte for byte as an independent encoder did for a live onyx-1 node', () => {
    expect(simulation.network).toBe('onyx-1')
    expect(encode64(unsignedCallTx(simulation.message as AminoMsg, simulation.gasWanted, simulation.feeUgnot))).toBe(simulation.txBase64)
  })
  it('reads the deposit and gas from the live onyx-1 answer, and only at 100 ugnot per byte', () => {
    const result = blob(simulation.resultBase64, 4096)
    expect(readSimulation(result, 100n)).toEqual({ gasUsed: 19_515_248, depositUgnot: 1_917_700n })
    expect(() => readSimulation(result, 99n)).toThrow('unavailable')
    expect(() => readSimulation(result.subarray(0, 300), 100n)).toThrow('unavailable')
  })
})

describe('private create quote provider', () => {
  const result = blob(simulation.resultBase64, 4096)
  const client = (simulateRaw: () => Promise<Uint8Array>) => ({ chainId, realm: NOTES_REALM, assertCurrent: vi.fn(), simulateRaw: vi.fn(simulateRaw) }) as unknown as NotesReadClient
  const input = (message: AminoMsg) => ({ chainId, message, requestDigest: 'aa'.repeat(32), height: '100' })
  it('quotes the simulated deposit and 1.2 × the simulated gas, the exact message simulated', async () => {
    const c = client(async () => result), message = create(1024, '2200000')
    const quote = await privateNoteQuote(c, '2200000')(input(message))
    expect(quote).toMatchObject({ source: 'simulation', estimatedDepositUgnot: '1917700', maxDepositUgnot: '2200000', gasWanted: 24_000_000, networkFeeUgnot: 28_800 })
    expect(vi.mocked(c.simulateRaw).mock.calls[0][0]).toEqual(unsignedCallTx(message, 78_000_000, 93_600))
  })
  it.each([
    ['the node cannot simulate', async () => { throw new Error('offline') }],
    ['the simulation reports an error', async () => Uint8Array.from([0x0a, 0x16, 0x0a, 0x14, 0x0a, 0x12, ...new TextEncoder().encode('/std.InternalError'), 0x18, 0x02])],
    ['the simulated deposit exceeds the cap', async () => result],
  ])('falls back to the bounded estimate when %s', async (name, simulate) => {
    const cap = name.includes('exceeds') ? '1800000' : '2200000'
    const quote = await privateNoteQuote(client(simulate), cap)(input(create(1024, cap)))
    expect(quote).toMatchObject({ source: 'bounded-estimate', estimatedDepositUgnot: '1787500', maxDepositUgnot: cap, gasWanted: 78_000_000, networkFeeUgnot: 93_600 })
  })
  it('refuses another storage price, a cap below the estimate, and a message for another cap or realm', async () => {
    const c = client(async () => result)
    network.price.mockResolvedValueOnce('"101ugnot"')
    await expect(privateNoteQuote(c, '2200000')(input(create(1024, '2200000')))).rejects.toThrow('format')
    await expect(privateNoteQuote(c, '1700000')(input(create(1024, '1700000')))).rejects.toThrow('format')
    await expect(privateNoteQuote(c, '2200000')(input(create(1024, '2300000')))).rejects.toThrow('format')
    const elsewhere = create(1024, '2200000'); elsewhere.value.pkg_path = 'gno.land/r/samcrew/memba_notes_rc1'
    await expect(privateNoteQuote(c, '2200000')(input(elsewhere))).rejects.toThrow('format')
    expect(c.simulateRaw).not.toHaveBeenCalled()
  })
})
