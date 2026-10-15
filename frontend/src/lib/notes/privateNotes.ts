// Private-notes entry, its own lazy chunk (privateNotes-*.js): load it only through loadPrivateNotes (./config.ts).
export { NotesIdentityController } from './identity/controller'
export type { IdentityChainState, IdentityContext, IdentitySetupPlan, IdentitySnapshot } from './identity/controller'
export { identityIntentScope, prepareIdentitySetupRequest } from './identity/request'
export type { IdentityQuoteInput, IdentityQuoteProvider, IdentityRequestOptions } from './identity/request'
export { addressBytes, readChainIdentity } from './identity/chain'
