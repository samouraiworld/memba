/**
 * The permanent memba_reviews_v2 subject of every curated storefront entry.
 * A subject is stored on-chain with each review: changing one orphans its
 * reviews. reviewSubjects.test.ts pins every value — never edit an existing one.
 * The table is literal on purpose: a subject is never derived from the
 * directory entry, so a project that later gains a realm KEEPS its pinned
 * subject. App Store reviews have always used the realm path for entries with
 * one; our games' realms are also their App Store listings, so a game's page
 * and its store page share one review pool.
 */
import type { EcosystemProject } from "./ecosystemDirectory"

export const GAME_REVIEW_SUBJECTS = {
    "block-party": "gno.land/r/samcrew/block_party",
    "space-invaders": "gno.land/r/samcrew/space_invaders",
    "barricade": "gno.land/r/samcrew/barricade",
    "connect4": "gno.land/r/samcrew/connect4",
} as const
export type ArcadeGameId = keyof typeof GAME_REVIEW_SUBJECTS

/** Keyed by ECOSYSTEM_PROJECTS id. A new project adds a line; an existing line never changes. */
export const CURATED_APP_SUBJECTS: Readonly<Record<string, string>> = {
    adena: "memba:app/adena",
    gnoswap: "gno.land/r/gnoswap/router",
    boards: "gno.land/r/gnoland/boards2/v0",
    akkadia: "memba:app/akkadia",
    "bubble-rumble": "memba:app/bubble-rumble",
    gnofly: "gno.land/r/g1t2kg2vtr3fukg43eujkn6x53gfdyakhngt4sfd/gnofly/game/v0",
    kourt: "gno.land/r/g1ecsuj0q572jr0dhu29q9njtnmw03hyu7tyyvv6/kourt",
    gnoscan: "memba:app/gnoscan",
    playground: "memba:app/playground",
    mygnoscan: "memba:app/mygnoscan",
}

export function projectReviewSubject(project: Pick<EcosystemProject, "id" | "realm">): string {
    const subject = Object.hasOwn(CURATED_APP_SUBJECTS, project.id) ? CURATED_APP_SUBJECTS[project.id] : undefined
    if (!subject) throw new Error(`No review subject pinned for project ${project.id}`)
    return subject
}

const CURATED: ReadonlySet<string> = new Set([...Object.values(GAME_REVIEW_SUBJECTS), ...Object.values(CURATED_APP_SUBJECTS)])

/** A subject Memba curates itself: reviewable without a live registry listing. */
export function isCuratedReviewSubject(subject: string): boolean {
    return CURATED.has(subject)
}
