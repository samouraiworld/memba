/** Fixture-only deployment capability; production table stays empty. */
export * from '../../src/lib/notes/config.ts'
const deployment = { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 as const }
export function notesDeployment() { return deployment }
