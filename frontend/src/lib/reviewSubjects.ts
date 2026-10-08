/**
 * The permanent memba_reviews_v2 subject of every curated storefront entry.
 * A subject is stored on-chain with each review: changing one orphans its
 * reviews. reviewSubjects.test.ts pins every value — never edit an existing one.
 * An entry with a realm uses the realm path, as App Store reviews always have;
 * our games' realms are also their App Store listings, so a game's page and its
 * store page share one review pool.
 */
import { ECOSYSTEM_PROJECTS, type EcosystemProject } from "./ecosystemDirectory"

export const CURATED_APP_PREFIX = "memba:app/"

export const GAME_REVIEW_SUBJECTS = {
    "block-party": "gno.land/r/samcrew/block_party",
    "space-invaders": "gno.land/r/samcrew/space_invaders",
    "barricade": "gno.land/r/samcrew/barricade",
    "connect4": "gno.land/r/samcrew/connect4",
} as const
export type ArcadeGameId = keyof typeof GAME_REVIEW_SUBJECTS

export function projectReviewSubject(project: Pick<EcosystemProject, "id" | "realm">): string {
    return project.realm?.path ?? `${CURATED_APP_PREFIX}${project.id}`
}

const CURATED: ReadonlySet<string> = new Set([...Object.values(GAME_REVIEW_SUBJECTS), ...ECOSYSTEM_PROJECTS.map(projectReviewSubject)])

/** A subject Memba curates itself: reviewable without a live registry listing. */
export function isCuratedReviewSubject(subject: string): boolean {
    return CURATED.has(subject)
}
