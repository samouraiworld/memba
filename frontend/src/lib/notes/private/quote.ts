import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted, MAX_GAS_WANTED } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import type { NotesReadClient } from '../chain/client'
import type { NotesQuoteProvider } from '../chain/request'
import { blob, check, decimal, NotesChainError, validNotesRealm } from '../chain/schema'
import { readSimulation, unsignedCallTx } from '../chain/simulate'
import { decodeManifest } from '../crypto/manifest'

/**
 * Bounded fallback for a private CreateNote, from the M0 keeper measurement (samcrew-deployer e485e2a on gno e75fef82,
 * 100 ugnot/B, steady trees; private-small-ops-m0-2026-10-15): 1,783,000-2,111,200 ugnot for 1-4 KB bodies.
 * - deposit ≈ (ciphertexts + manifest + commitment + 15,300 B + 2,400 B per extra envelope) × 100: at or above every
 *   M0 row (1 KB 1,787,500 vs 1,784,800; 4 KB 2,113,900 vs 2,111,200) and the 10-08 create1max (15,208,700 vs 15,206,500).
 * - cap (max_deposit) = estimate × 1.2, rounded up to 0.1 GNOT; a cap is a ceiling, never charged.
 * - gas = 60 M + 2,200 per argument byte + 12 M per envelope, rounded up to 1 M, at most MAX_GAS_WANTED (500 M):
 *   ≥ 1.7× every M0 create row (42.5-44.9 M); 373 M for create1max (43.7 M), 500 M for create32max (349 M).
 * Commit (M0 rows 21.2-21.9 M gas): deposit ≈ (ciphertext growth + 500 B) × 100, the same cap rule and gas formula
 * (no envelope): 63-65 M for 1-2 KB bodies, ≥ 2.9× the M0 rows.
 * ApplyAccess (M0 rows 4: +1 reader 363,000 / 370,800 ugnot, 54.9 / 65.5 M gas; 10-08 1 → 32: 11,652,800, 367 M):
 * deposit ≈ (3,800 B per added envelope + 600 B per new writer flag, at least 500 B) × 100, the same cap rule and gas
 * formula over the manifest: 90 M at 2 envelopes, 105 M at 3 (≥ 1.6×), 500 M at 32. A reader made a writer (M0 row 6
 * and the E2 keeper rows, same harness: 42,600 / 49,800 ugnot, 56.9 / 57.1 M) costs 600 B: 60,000, cap 0.1 GNOT, 90 M.
 * Rotate (M0 rows 5: 2 → 1 267,000, 3 → 2 403,100 ugnot, 48.1 / 57.7 M gas; 10-08 rotate32max 4,532,400, 390 M):
 * deposit ≈ (new manifest + 4,000 B + ciphertext growth) × 100: 530,100 for 2 → 1, 660,000 for 3 → 2, 4,557,000 at 32.
 * A writer made a reader again is a Rotate that keeps both holders (E2 keeper rows: 589,800 / 583,800 ugnot, 58.2 M):
 * 660,000, cap 0.8 GNOT, 93 M for a 1 KB body.
 */
/** A simulation (readable, from a verified node) says the note needs more storage deposit than the reviewed cap. */
export class PrivateStorageAboveCap extends Error {
  constructor(readonly requiredUgnot: string) { super('Notes private: storage deposit above the cap'); this.name = 'PrivateStorageAboveCap' }
}
/** Simulated gas is trusted only upward: never below 60 M (the M0 creates used 42.5-44.9 M), whatever a node reports. */
const SIMULATED_GAS_FLOOR = 60_000_000
const CREATE_OVERHEAD_BYTES = 15_300, PER_EXTRA_ENVELOPE_BYTES = 2_400, COMMIT_MARGIN_BYTES = 500, STORAGE_PRICE_UGNOT = 100, CAP_STEP_UGNOT = 100_000
const ADDED_ENVELOPE_BYTES = 3_800, NEW_WRITER_BYTES = 600, ROTATE_OVERHEAD_BYTES = 4_000
/** The note's current ciphertext sizes: a Commit or a Rotate only pays for growth (encrypted notes keep no history). */
export interface PrivateCommitSizes { title: number; body: number }
/** The note's current envelopes (and how many write): ApplyAccess pays per added envelope and new writer flag. */
export interface PrivateAccessBase { envelopes: number; writers: number }
const sizes = (value: PrivateCommitSizes | PrivateAccessBase | undefined): value is PrivateCommitSizes => !!value && 'title' in value
  && [value.title, value.body].every(size => Number.isSafeInteger(size) && size >= 0 && size <= 135223)
export function privateNoteBudget(message: AminoMsg, previous?: PrivateCommitSizes | PrivateAccessBase): { gasWanted: number; estimatedDepositUgnot: string; suggestedCapUgnot: string } {
  check(message.type === 'vm/MsgCall' && validNotesRealm(message.value.pkg_path))
  const { func, args } = message.value; check(Array.isArray(args))
  let bytes: number, estimate: number, envelopes = 0
  if (func === 'CreateNote') {
    check(args.length === 8)
    const title = blob(args[2], 231).length, body = blob(args[3], 135223).length, manifest = blob(args[4], 41570).length, commitment = blob(args[5], 32).length
    envelopes = (manifest - 2) / 1299
    check(commitment === 32 && Number.isInteger(envelopes) && envelopes >= 1 && envelopes <= 32)
    bytes = title + body + manifest + commitment
    estimate = (bytes + CREATE_OVERHEAD_BYTES + PER_EXTRA_ENVELOPE_BYTES * (envelopes - 1)) * STORAGE_PRICE_UGNOT
  } else if (func === 'ApplyAccess') {
    check(args.length === 6 && previous !== undefined && 'envelopes' in previous)
    const manifest = blob(args[4], 41570), list = decodeManifest(manifest, Number(decimal(args[2], 32, true)))
    const added = list.length - previous.envelopes, writers = list.filter(entry => entry.writer).length - previous.writers
    check([previous.envelopes, previous.writers].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 32) && added >= 0 && writers >= 0)
    bytes = manifest.length; envelopes = list.length
    estimate = Math.max(COMMIT_MARGIN_BYTES, ADDED_ENVELOPE_BYTES * added + NEW_WRITER_BYTES * writers) * STORAGE_PRICE_UGNOT
  } else if (func === 'Rotate') {
    check(args.length === 9 && sizes(previous))
    const title = blob(args[4], 231).length, body = blob(args[5], 135223).length, manifest = blob(args[6], 41570).length, commitment = blob(args[7], 32).length
    envelopes = (manifest - 2) / 1299
    check(commitment === 32 && Number.isInteger(envelopes) && envelopes >= 1 && envelopes <= 32)
    bytes = title + body + manifest + commitment
    estimate = (manifest + ROTATE_OVERHEAD_BYTES + Math.max(0, title + body - previous.title - previous.body)) * STORAGE_PRICE_UGNOT
  } else {
    // M0 Commit rows: 18 B for the same size, exactly the ciphertext growth otherwise (1 KB → 2 KB: 1,088 B), 0 for a
    // title + body rewrite at the same size. Estimate = (growth of the changed fields, never below 0, + 500 B) × 100.
    check(func === 'Commit' && args.length === 7 && ['1', '2', '3'].includes(args[3]) && sizes(previous))
    const title = args[3] === '2' ? 0 : blob(args[4], 231).length, body = args[3] === '1' ? 0 : blob(args[5], 135223).length
    check((args[3] === '2') === (args[4] === '') && (args[3] === '1') === (args[5] === ''))
    bytes = title + body
    const growth = (args[3] === '2' ? 0 : title - previous.title) + (args[3] === '1' ? 0 : body - previous.body)
    estimate = (Math.max(0, growth) + COMMIT_MARGIN_BYTES) * STORAGE_PRICE_UGNOT
  }
  // Capped at the transaction ceiling, which stays above the 10-08 maxima (create32max 349 M).
  const gasWanted = Math.min(MAX_GAS_WANTED, Math.ceil((60_000_000 + bytes * 2_200 + envelopes * 12_000_000) / 1_000_000) * 1_000_000)
  return { gasWanted, estimatedDepositUgnot: String(estimate), suggestedCapUgnot: String(Math.ceil(estimate * 1.2 / CAP_STEP_UGNOT) * CAP_STEP_UGNOT) }
}
/**
 * Simulation first: the node runs the exact unsigned message (`.app/simulate`), which gives the deposit it locks and the
 * gas it uses (wanted = used × 1.2, at least 60 M, never above the bound). A readable answer that the deposit exceeds the
 * cap refuses (PrivateStorageAboveCap); any other simulation failure falls back to the bounded estimate, labelled as such.
 * Either way the storage price must be 100 ugnot/B and the deposit must fit the reviewed cap.
 */
export function privateNoteQuote(client: NotesReadClient, maxDepositUgnot: string, previous?: PrivateCommitSizes | PrivateAccessBase): NotesQuoteProvider {
  return simulationFirstQuote(client, maxDepositUgnot, message => privateNoteBudget(message, previous))
}
/** The same simulation-first rules for any private-notes message, with `budget` as its bounded fallback. */
export function simulationFirstQuote(client: NotesReadClient, maxDepositUgnot: string, budget: (message: AminoMsg) => ReturnType<typeof privateNoteBudget>): NotesQuoteProvider {
  const cap = decimal(maxDepositUgnot, 63)
  return async input => {
    client.assertCurrent(); check(input.chainId === client.chainId && input.message.value.pkg_path === client.realm && input.message.value.max_deposit === `${cap}ugnot`)
    const bound = budget(input.message)
    if (BigInt(cap) < BigInt(bound.estimatedDepositUgnot)) throw new NotesChainError('format')
    const urls = getRpcUrlsInOrder()
    const [price, boundFee] = await Promise.all([
      abciQueryText({ chainId: client.chainId, rpcUrl: urls[0], rpcUrls: urls }, 'params/vm:p:storage_price', ''), freshFeeForGasWanted(bound.gasWanted)])
    client.assertCurrent()
    // A changed network price invalidates the measured profile, rather than silently raising a budget.
    check(price.length < 64 && JSON.parse(price) === '100ugnot')
    let measured: ReturnType<typeof readSimulation> | null = null
    try { measured = readSimulation(await client.simulateRaw(unsignedCallTx(input.message, bound.gasWanted, boundFee)), BigInt(STORAGE_PRICE_UGNOT)) }
    catch { measured = null }
    client.assertCurrent()
    // A readable answer that the deposit exceeds the cap refuses: never a fallback the node predicts will fail on chain.
    if (measured && (measured.aboveCap || measured.depositUgnot > BigInt(cap))) throw new PrivateStorageAboveCap(measured.depositUgnot.toString())
    const simulated = measured !== null && measured.depositUgnot > 0n && measured.gasUsed < bound.gasWanted
    const gasWanted = simulated ? Math.min(bound.gasWanted, Math.max(SIMULATED_GAS_FLOOR, Math.ceil(measured!.gasUsed * 1.2 / 1_000_000) * 1_000_000)) : bound.gasWanted
    const networkFeeUgnot = gasWanted === bound.gasWanted ? boundFee : await freshFeeForGasWanted(gasWanted)
    client.assertCurrent()
    return {
      requestDigest: input.requestDigest, chainId: input.chainId, atHeight: decimal(input.height, 63, true),
      expiresAtHeight: (BigInt(input.height) + 20n).toString(), expiresAtMs: Date.now() + 90_000,
      source: simulated ? 'simulation' : 'bounded-estimate', estimatedDepositUgnot: simulated ? measured!.depositUgnot.toString() : bound.estimatedDepositUgnot,
      maxDepositUgnot: cap, gasWanted, networkFeeUgnot,
    }
  }
}
