import { NotesCryptoError } from '../../../../lib/notes/crypto/bytes'

/** Adena, for the unlock signatures: read at the click, never on load. */
export const adenaWallet = (): unknown => (window as unknown as { adena?: unknown }).adena
export function unlockProblem(error: unknown): string {
    if (error instanceof NotesCryptoError && error.code === 'wallet') return 'Adena did not sign. Your key stays locked.'
    if (error instanceof NotesCryptoError && error.code === 'signature') return 'Adena\u2019s signature could not be checked. Make sure Adena is on this network with this account, then try again. Your key stays locked.'
    if (error instanceof NotesCryptoError && error.code === 'decrypt') return 'This signature does not open your key. Use your recovery phrase and file instead.'
    return 'Your key could not be unlocked. Nothing was changed. Try again.'
}
/** Another app re-keyed this account in the shared key registry (controller phase `changed`): every private view is read only. */
export const KEY_CHANGED = 'Your private key changed outside Memba.'
