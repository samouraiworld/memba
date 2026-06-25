/**
 * Hero headline variants for the visitor home.
 *
 * To A/B-test: change ACTIVE_HEADLINE to HERO_HEADLINES.atlas.
 * Default is .manifesto — the current production copy.
 */

export const HERO_HEADLINES = {
    manifesto: "Run your DAO. Own your stack.",
    atlas: "Explore the gno.land sovereignty stack.",
} as const

export const ACTIVE_HEADLINE = HERO_HEADLINES.manifesto // default: keep the current production line; flip to .atlas is one line
