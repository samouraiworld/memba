// Private-notes entry, its own lazy chunk (privateNotes-*.js): load it only through loadPrivateNotes (./config.ts).
// The private UI is exported from here too, so its code and CSS arrive with this chunk and never with public Notes.
import type { DraftSession } from './drafts'
import type { NotesReadClient } from './chain/client'
import { NotesIdentityController } from './identity/controller'
import { addressBytes, readChainIdentity } from './identity/chain'
export { NotesIdentityController } from './identity/controller'
export type { IdentityChainState, IdentityContext, IdentitySetupPlan, IdentitySnapshot } from './identity/controller'
export { identityIntentScope, prepareIdentitySetupRequest } from './identity/request'
export type { IdentityQuoteInput, IdentityQuoteProvider, IdentityRequestOptions } from './identity/request'
export { addressBytes, readChainIdentity } from './identity/chain'
export { PrivateNotesPanel } from '../../os/apps/notes/private/PrivateNotesPanel'
export { PrivateNoteView } from '../../os/apps/notes/private/PrivateNoteView'
export { SharedWithMe } from '../../os/apps/notes/private/SharedWithMe'
export { PrivateChoice, PrivateReview } from '../../os/apps/notes/private/PrivatePublish'
import { recoverPrivateIntent as recoverNoteIntent } from './private/recovery'
import { recoverAccessIntent } from './chain/accessRequest'
/** Private receipts, checked against the chain and never resent: an encrypted note's own (private-v1) or its deletion (access-v1). */
export const recoverPrivateIntent: typeof recoverNoteIntent = (client, intents, intent, session) =>
    intent.verification?.kind === 'access-v1' ? recoverAccessIntent(client, intents, intent, session) : recoverNoteIntent(client, intents, intent, session)

/**
 * The one key controller of a Notes window for (network, realm, account). The caller disposes it when that
 * scope ends (account or network switch, Shell lock, window close): `session` aborting locks it too.
 */
export function createIdentityController(client: NotesReadClient, owner: string, session: DraftSession): NotesIdentityController {
    return new NotesIdentityController({
        chainId: client.chainId, realm: client.realm, address: owner, addressBytes: addressBytes(owner), session,
        isCurrent: () => { try { client.assertCurrent(); return true } catch { return false } },
        read: () => readChainIdentity(client, owner),
    })
}
