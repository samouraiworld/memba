import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bech32Encode } from '../../dao/realmAddress'
import { isValidGnoAddressChecksum } from '../../dao/address'
import { asciiText, equalBytes, NotesCryptoError, requireBytes, utf8 } from './bytes'

export const UNLOCK_TEXT = 'Memba Notes unlock v1\nOrigin: https://memba.club\nSigning this lets the holder decrypt your private Memba notes. Never sign it on another site.'
export interface UnlockContext { chainId: string; signer: string }
export interface NotesArbitraryWallet { SignArbitrary(params: { signer: string; data: string }): Promise<unknown> }
export interface VerifiedUnlock { ikm: Uint8Array; publicKey: Uint8Array }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NotesCryptoError('signature')
  return value as Record<string, unknown>
}
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)) }
function decode64(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new NotesCryptoError('signature')
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
    if (bytes.length !== length || base64(bytes) !== value) throw new NotesCryptoError('signature')
    return bytes
  } catch { throw new NotesCryptoError('signature') }
}
/** Adena's ADR-036 variant signs the connected chain_id, unlike Cosmos's empty chain_id. */
export function unlockDocument(expected: UnlockContext): Record<string, unknown> {
  asciiText(expected.chainId, 64)
  if (!isValidGnoAddressChecksum(expected.signer)) throw new NotesCryptoError('signature')
  return {
    account_number: '0', chain_id: expected.chainId, fee: { amount: [], gas: '0' }, memo: '',
    msgs: [{ type: 'sign/MsgSignData', value: { data: base64(utf8(UNLOCK_TEXT)), signer: expected.signer } }], sequence: '0',
  }
}
/** Bounded canonicalization rejects unknown values rather than dropping fields during stringify. */
export function arbitrarySignBytes(document: unknown): Uint8Array {
  let nodes = 0
  function sorted(value: unknown, depth: number): unknown {
    if (++nodes > 64 || depth > 6) throw new NotesCryptoError('signature')
    if (typeof value === 'string') {
      if (value.length > 4096) throw new NotesCryptoError('signature')
      return value
    }
    if (Array.isArray(value)) {
      if (value.length > 4) throw new NotesCryptoError('signature')
      return value.map(item => sorted(item, depth + 1))
    }
    const object = record(value), keys = Object.keys(object).sort()
    if (keys.length > 10 || keys.some(key => key.length > 64)) throw new NotesCryptoError('signature')
    return Object.fromEntries(keys.map(key => [key, sorted(object[key], depth + 1)]))
  }
  return utf8(JSON.stringify(sorted(document, 0)).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e'))
}
export function verifyArbitrarySignature(document: unknown, signature: Uint8Array, publicKey: Uint8Array, expected: UnlockContext): Uint8Array {
  const wanted = arbitrarySignBytes(unlockDocument(expected))
  if (!equalBytes(arbitrarySignBytes(document), wanted)) throw new NotesCryptoError('signature')
  requireBytes(signature, 64); requireBytes(publicKey, 33)
  if (bech32Encode('g', ripemd160(sha256(publicKey))) !== expected.signer) throw new NotesCryptoError('signature')
  try {
    if (!secp256k1.verify(signature, wanted, publicKey, { lowS: false })) throw new NotesCryptoError('signature')
    const parsed = secp256k1.Signature.fromBytes(signature), order = secp256k1.Point.Fn.ORDER
    return new secp256k1.Signature(parsed.r, parsed.s > order / 2n ? order - parsed.s : parsed.s).toBytes()
  } catch { throw new NotesCryptoError('signature') }
}
export function verifyUnlockResponse(response: unknown, expected: UnlockContext): VerifiedUnlock {
  const envelope = record(response)
  if (envelope.status !== 'success' || envelope.code !== 0) throw new NotesCryptoError('wallet')
  const data = record(envelope.data), signature = record(data.signature), pub = record(signature.pubKey)
  if (pub.typeUrl !== '/tm.PubKeySecp256k1') throw new NotesCryptoError('signature')
  const publicKey = decode64(pub.value, 33), rawSignature = decode64(signature.signature, 64)
  try { return { ikm: verifyArbitrarySignature(data.signed, rawSignature, publicKey, expected), publicKey } }
  finally { rawSignature.fill(0) }
}
/** Call only from an explicit unlock click. The owner supplies the current account/network guard. */
export async function requestNotesUnlock(wallet: unknown, expected: UnlockContext, isCurrent: () => boolean): Promise<VerifiedUnlock> {
  const stable = { ...expected }
  unlockDocument(stable)
  if (!isCurrent()) throw new NotesCryptoError('identity')
  if (!wallet || typeof wallet !== 'object' || typeof (wallet as Partial<NotesArbitraryWallet>).SignArbitrary !== 'function') throw new NotesCryptoError('wallet')
  let response: unknown
  try { response = await (wallet as NotesArbitraryWallet).SignArbitrary({ signer: stable.signer, data: UNLOCK_TEXT }) }
  catch { throw new NotesCryptoError('wallet') }
  if (!isCurrent()) throw new NotesCryptoError('identity')
  return verifyUnlockResponse(response, stable)
}
