import { validateFeaturedRelease, type FeaturedNoteRelease } from './featuredNoteSeed'

/** No default/fixture release: exact IDs, author, content and chain canary need review first.
 * This table attests no deployment capability and never enables a transaction by itself. */
const RELEASES: Readonly<Record<string, readonly FeaturedNoteRelease[]>> = {}
/** `realm` is the network deployment's realm path; every release must name it. */
export function featuredNoteReleases(chainId: string, realm: string): readonly FeaturedNoteRelease[] {
  if (!Object.hasOwn(RELEASES, chainId)) return []
  return RELEASES[chainId].map(value => validateFeaturedRelease(value, chainId, realm))
}
