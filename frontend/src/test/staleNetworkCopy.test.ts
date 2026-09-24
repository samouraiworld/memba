/**
 * Copy on screens that mainnet users see must not name a retired test chain or
 * advertise numbers and features that are out of date: the quest "coming soon"
 * notes said "live on test13", and onboarding promised "85 quests" and a
 * "10-model" AI Analyst that is switched off in production.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const src = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p: string) => readFileSync(join(src, p), "utf8")

describe("stale network copy", () => {
    it.each(["pages/QuestHub.tsx", "pages/QuestDetail.tsx"])("%s does not say quests are pending on test13", (file) => {
        expect(read(file)).not.toMatch(/live on test13/)
    })

    it("onboarding does not advertise a quest count or the disabled AI Analyst", () => {
        const wizard = read("components/ui/OnboardingWizard.tsx")
        expect(wizard).not.toMatch(/\b\d+ quests\b/)
        expect(wizard).not.toMatch(/AI Analyst|10-model/)
    })
})
