/** Fixture-only IDs, aliased over the production release table (src/lib/notes/featuredNoteRelease.ts), which is not modified. */
import type { FeaturedNoteRelease } from '../../src/lib/notes/featuredNoteSeed'
import { NOTE_ID } from '../sushi-shell/audit'
import { TEST_OWNER } from './session'
export function featuredNoteReleases(chainId: string, realm: string): readonly FeaturedNoteRelease[] {
    return [{ releaseKey: 'sushi-v1', chainId, realm, version: 1, noteId: NOTE_ID, mode: 4, deleted: false, owner: TEST_OWNER }]
}
