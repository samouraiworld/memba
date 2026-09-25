/**
 * missingCommunityRealms — the realms-not-deployed notice must reflect the
 * actual allowlist per network, not a hard-coded "nothing is here".
 */
import { describe, it, expect } from "vitest"
import { missingCommunityRealms } from "./communityRealms"
import { isRealmValidOn, MEMBA_DAO } from "./config"

describe("missingCommunityRealms", () => {
    it("on gno.land mainnet lists only the community realms that are not allowlisted", () => {
        const missing = missingCommunityRealms("mainnet")
        expect(missing).not.toContain("feed")
        expect(missing).not.toContain("quests")
        expect(missing).toEqual(
            ["channels", "candidature"].filter(name =>
                !isRealmValidOn("mainnet", name === "channels" ? MEMBA_DAO.channelsPath : MEMBA_DAO.candidaturePath)),
        )
    })

    it("on gno.land mainnet names exactly channels and candidature", () => {
        // Pinned, not derived from the allowlist: feed and quests work on mainnet;
        // the channels realm is on chain but closed to members, and candidature is
        // not deployed. Changing this list must be a deliberate, verified decision.
        expect(missingCommunityRealms("mainnet")).toEqual(["channels", "candidature"])
    })

    it("mirrors isRealmValidOn for every feature", () => {
        const paths: Record<string, string> = {
            channels: MEMBA_DAO.channelsPath,
            candidature: MEMBA_DAO.candidaturePath,
            feed: MEMBA_DAO.feedPath,
            quests: "gno.land/r/samcrew/memba_quest_attestation_v1",
        }
        for (const net of ["mainnet", "test13", "pearl"]) {
            const expected = Object.entries(paths).filter(([, p]) => !isRealmValidOn(net, p)).map(([n]) => n)
            expect(missingCommunityRealms(net)).toEqual(expected)
        }
    })
})
