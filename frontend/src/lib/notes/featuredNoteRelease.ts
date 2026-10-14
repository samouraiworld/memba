import { validateFeaturedRelease, type FeaturedNoteRelease } from './featuredNoteSeed'

/**
 * Reviewed featured notes per network. Each entry is checked against the network's deployment realm
 * before use; this table attests no deployment capability and never enables a transaction by itself.
 */
const RELEASES: Readonly<Record<string, readonly FeaturedNoteRelease[]>> = Object.freeze({
  // Mainnet Sushi recipe ("Avocado & cucumber maki"): published 2026-10-14 by the owner, created at
  // h806987, read back at h807003 (owner, mode 4, not deleted, listed, public writes allowed).
  'gnoland-1': Object.freeze([Object.freeze({ releaseKey: 'sushi-v1', chainId: 'gnoland-1', realm: 'gno.land/r/samcrew/memba_notes_v1',
    version: 1, noteId: '4251ea96d68d64737ce7a829f4af22c5', mode: 4, deleted: false, owner: 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c' } as const)]),
})
/** `realm` is the network deployment's realm path; every release must name it. */
export function featuredNoteReleases(chainId: string, realm: string): readonly FeaturedNoteRelease[] {
  if (!Object.hasOwn(RELEASES, chainId)) return []
  return RELEASES[chainId].map(value => validateFeaturedRelease(value, chainId, realm))
}
