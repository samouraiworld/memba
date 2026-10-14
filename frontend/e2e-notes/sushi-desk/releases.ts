/** Fixture-only IDs; no production release table is modified. */
import type { FeaturedNoteRelease } from '../../src/lib/notes/featuredNoteSeed'
import { NOTE_ID } from '../sushi-shell/audit'
import { TEST_OWNER } from './session'
export function featuredNoteReleases(chainId: string): readonly FeaturedNoteRelease[] {
    return [{ releaseKey: 'sushi-v1', chainId, realm: 'gno.land/r/samcrew/memba_notes_v1', version: 1, noteId: NOTE_ID, mode: 4, deleted: false, owner: TEST_OWNER }]
}
