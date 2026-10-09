import { validateFeaturedRelease, type FeaturedNoteRelease } from './featuredNoteSeed'

/** No default/fixture release: exact IDs, author, content and chain canary need review first.
 * This table attests no deployment capability and never enables a transaction by itself. */
const RELEASES: Readonly<Record<string, readonly FeaturedNoteRelease[]>> = {}
export function featuredNoteReleases(chainId: string): readonly FeaturedNoteRelease[] {
  if (!Object.hasOwn(RELEASES, chainId)) return []
  return RELEASES[chainId].map(value => validateFeaturedRelease(value, chainId))
}
