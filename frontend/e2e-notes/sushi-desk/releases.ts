/** Fixture-only IDs; no production release table is modified. */
import type { FeaturedNoteRelease } from '../../src/lib/notes/featuredNoteSeed'
import { NOTES_REALM } from '../../src/lib/notes/config.ts'
import { NOTE_ID } from '../sushi-shell/audit'
import { TEST_OWNER } from './session'
export function featuredNoteReleases(chainId: string): readonly FeaturedNoteRelease[] {
    return [{ releaseKey: 'sushi-v1', chainId, realm: NOTES_REALM, version: 1, noteId: NOTE_ID, mode: 4, deleted: false, owner: TEST_OWNER }]
}
