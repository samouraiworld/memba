/** Fixture: no featured release, so the public stage under test is the only Notes reader (the production table seeds a real note). */
import type { FeaturedNoteRelease } from '../../src/lib/notes/featuredNoteSeed'
export function featuredNoteReleases(): readonly FeaturedNoteRelease[] { return [] }
