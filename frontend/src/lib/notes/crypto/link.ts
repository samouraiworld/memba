import { concat, NotesCryptoError, requireBytes, requireEpoch, u32 } from './bytes'

export interface LinkSecret { key: Uint8Array; epoch: number }
/** Exact v1 fragment only: 36 bytes become 48 unpadded base64url characters. Never accept query input. */
export function parseSecretLink(fragment: string): LinkSecret | null {
  if (typeof fragment !== 'string' || fragment.length !== 51 || !/^#k=[A-Za-z0-9_-]{48}$/.test(fragment)) return null
  try {
    const binary = atob(fragment.slice(3).replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), epoch = new DataView(bytes.buffer).getUint32(32)
    requireEpoch(epoch)
    const key = bytes.slice(0, 32)
    bytes.fill(0)
    return { key, epoch }
  } catch { return null }
}
export function formatSecretLink(secret: LinkSecret): string {
  requireBytes(secret.key, 32); requireEpoch(secret.epoch)
  const bytes = concat(secret.key, u32(secret.epoch))
  return '#k=' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}
/** Bootstrap owns fragment removal before telemetry. This reader only owns the in-memory key. */
export function createOneTimeLinkReader(fragment: string): () => LinkSecret | null {
  let secret = parseSecretLink(fragment)
  return () => {
    if (!secret) return null
    const copy = { key: secret.key.slice(), epoch: secret.epoch }
    secret.key.fill(0); secret = null
    return copy
  }
}
export function verifyLinkEpoch(secret: LinkSecret, currentEpoch: number): void {
  requireEpoch(secret.epoch); requireEpoch(currentEpoch)
  if (secret.epoch !== currentEpoch) throw new NotesCryptoError('identity')
}
