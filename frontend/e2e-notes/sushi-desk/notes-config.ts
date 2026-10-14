/** Fixture-only deployment capability (the production deployment table is in src/lib/notes/config.ts). */
export * from '../../src/lib/notes/config.ts'
const deployment = { realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1 as const }
export function notesDeployment() { return deployment }
