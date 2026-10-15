import { abciQueryText } from '../../dao/packageStatus'
import { freshFeeForGasWanted, MAX_GAS_WANTED } from '../../grc20'
import type { AminoMsg } from '../../grc20'
import { getRpcUrlsInOrder } from '../../rpcFallback'
import type { NotesReadClient } from '../chain/client'
import type { NotesQuoteProvider } from '../chain/request'
import { blob, check, decimal, NotesChainError, validNotesRealm } from '../chain/schema'
import { readSimulation, unsignedCallTx } from '../chain/simulate'

/**
 * Bounded fallback for a private CreateNote, from the M0 keeper measurement (samcrew-deployer e485e2a on gno e75fef82,
 * 100 ugnot/B, steady trees; private-small-ops-m0-2026-10-15): 1,783,000-2,111,200 ugnot for 1-4 KB bodies.
 * - deposit ≈ (ciphertexts + manifest + commitment + 15,300 B + 2,400 B per extra envelope) × 100: at or above every
 *   M0 row (1 KB 1,787,500 vs 1,784,800; 4 KB 2,113,900 vs 2,111,200) and the 10-08 create1max (15,208,700 vs 15,206,500).
 * - cap (max_deposit) = estimate × 1.2, rounded up to 0.1 GNOT; a cap is a ceiling, never charged.
 * - gas = 60 M + 2,200 per argument byte + 12 M per envelope, rounded up to 1 M, at most MAX_GAS_WANTED (500 M):
 *   ≥ 1.7× every M0 create row (42.5-44.9 M); 373 M for create1max (43.7 M), 500 M for create32max (349 M).
 */
/** A simulation (readable, from a verified node) says the note needs more storage deposit than the reviewed cap. */
export class PrivateStorageAboveCap extends Error {
  constructor(readonly requiredUgnot: string) { super('Notes private: storage deposit above the cap'); this.name = 'PrivateStorageAboveCap' }
}
/** Simulated gas is trusted only upward: never below 60 M (the M0 creates used 42.5-44.9 M), whatever a node reports. */
const SIMULATED_GAS_FLOOR = 60_000_000
const CREATE_OVERHEAD_BYTES = 15_300, PER_EXTRA_ENVELOPE_BYTES = 2_400, STORAGE_PRICE_UGNOT = 100, CAP_STEP_UGNOT = 100_000
export function privateNoteBudget(message: AminoMsg): { gasWanted: number; estimatedDepositUgnot: string; suggestedCapUgnot: string } {
  check(message.type === 'vm/MsgCall' && validNotesRealm(message.value.pkg_path))
  const { func, args } = message.value; check(func === 'CreateNote' && Array.isArray(args) && args.length === 8)
  const title = blob(args[2], 231).length, body = blob(args[3], 135223).length, manifest = blob(args[4], 41570).length, commitment = blob(args[5], 32).length
  const envelopes = (manifest - 2) / 1299
  check(commitment === 32 && Number.isInteger(envelopes) && envelopes >= 1 && envelopes <= 32)
  const bytes = title + body + manifest + commitment
  const estimate = (bytes + CREATE_OVERHEAD_BYTES + PER_EXTRA_ENVELOPE_BYTES * (envelopes - 1)) * STORAGE_PRICE_UGNOT
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
export function privateNoteQuote(client: NotesReadClient, maxDepositUgnot: string): NotesQuoteProvider {
  const cap = decimal(maxDepositUgnot, 63)
  return async input => {
    client.assertCurrent(); check(input.chainId === client.chainId && input.message.value.pkg_path === client.realm && input.message.value.max_deposit === `${cap}ugnot`)
    const bound = privateNoteBudget(input.message)
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
