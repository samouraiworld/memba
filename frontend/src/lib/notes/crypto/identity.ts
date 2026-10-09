import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ml_kem768_x25519 as xwing } from '@noble/post-quantum/hybrid.js'
import { domain, equalBytes, NotesCryptoError, randomBytes, requireBytes, text } from './bytes'

export interface NotesIdentity { publicKey: Uint8Array; secretKey: Uint8Array }
export const newIdentitySeed = (): Uint8Array => randomBytes(32)
/** A new seed is created only by an explicit setup/migration action, never by recovery failure. */
export function identityFromSeed(seed: Uint8Array): NotesIdentity {
  const expanded = hkdf(sha256, requireBytes(seed, 32), domain('identity'), text('xwing-draft10'), 32)
  try {
    const keys = xwing.keygen(expanded)
    try { return { publicKey: keys.publicKey.slice(), secretKey: keys.secretKey.slice() } }
    finally { keys.secretKey.fill(0) }
  } finally { expanded.fill(0) }
}
export function verifiedIdentity(seed: Uint8Array, registeredPublicKey: Uint8Array): NotesIdentity {
  requireBytes(registeredPublicKey, 1216)
  const identity = identityFromSeed(seed)
  if (!equalBytes(identity.publicKey, registeredPublicKey)) {
    identity.secretKey.fill(0)
    throw new NotesCryptoError('identity')
  }
  return identity
}
