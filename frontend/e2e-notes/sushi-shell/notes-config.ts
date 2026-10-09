/** Fixture-only deployment capability; production table stays empty. */
export * from '../../src/lib/notes/config.ts'
import { NOTES_REALM } from '../../src/lib/notes/config.ts'
const deployment = { realm: NOTES_REALM, version: 1 as const }
export function notesDeployment() { return deployment }
