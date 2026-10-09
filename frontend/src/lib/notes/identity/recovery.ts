import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { sha256 } from '@noble/hashes/sha2.js'
import { blob, encode64, record } from '../chain/schema'
import { equalBytes, NotesCryptoError, requireBytes } from '../crypto/bytes'
import { parseBackup } from '../crypto/backup'

export const RECOVERY_LABEL = 'Notes recovery phrase — not your wallet phrase'
/** BIP-39 is used only as a checksum-protected encoding of 256-bit entropy, never as a wallet seed. */
export function recoveryPhrase(entropy: Uint8Array): string { return entropyToMnemonic(requireBytes(entropy, 32), wordlist) }
export function recoveryEntropy(phrase: string): Uint8Array {
  if (typeof phrase !== 'string' || phrase.length > 512) throw new NotesCryptoError('format')
  const normalized = phrase.trim().replace(/\s+/g, ' ')
  if (normalized.split(' ').length !== 24 || !/^[a-z ]+$/.test(normalized)) throw new NotesCryptoError('format')
  try { return requireBytes(mnemonicToEntropy(normalized, wordlist), 32) }
  catch { throw new NotesCryptoError('format') }
}
export interface RecoveryRecord { backup: Uint8Array; publicKey: Uint8Array }
function validateRecoveryRecord(value: RecoveryRecord): RecoveryRecord {
  const parsed = parseBackup(value.backup), pk = requireBytes(value.publicKey, 1216)
  if (parsed.binding.mode !== 'vault' || !equalBytes(sha256(pk), parsed.binding.publicKeyHash)) throw new NotesCryptoError('identity')
  return { backup: value.backup.slice(), publicKey: pk.slice() }
}
/** Only encrypted backup records and public keys are exported; the phrase is stored separately. */
export function recoveryFile(records: RecoveryRecord[]): string {
  if (records.length < 1 || records.length > 8) throw new NotesCryptoError('format')
  return JSON.stringify({ type: 'memba-notes-recovery', version: 1, records: records.map(value => {
    const checked = validateRecoveryRecord(value)
    return { backup: encode64(checked.backup), public_key: encode64(checked.publicKey) }
  }) }, null, 2)
}
export function readRecoveryFile(text: string): RecoveryRecord[] {
  if (typeof text !== 'string' || text.length > 24000) throw new NotesCryptoError('format')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new NotesCryptoError('format') }
  const top = record(value, ['type', 'version', 'records'])
  if (top.type !== 'memba-notes-recovery' || top.version !== 1 || !Array.isArray(top.records) || top.records.length < 1 || top.records.length > 8) throw new NotesCryptoError('format')
  const seen = new Set<string>()
  return top.records.map(item => {
    const value = record(item, ['backup', 'public_key'])
    const checked = validateRecoveryRecord({ backup: blob(value.backup, 365), publicKey: blob(value.public_key, 1216) })
    const c = parseBackup(checked.backup).binding, key = JSON.stringify([c.chainId, c.realm, encode64(c.address), c.generation.toString()])
    if (seen.has(key)) throw new NotesCryptoError('format'); seen.add(key); return checked
  })
}
