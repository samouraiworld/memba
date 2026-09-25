import { describe, it, expect } from "vitest"
import {
    QUEST_REQUIRED_REALMS,
    isQuestAvailableOnNetwork,
    notOnNetworkMessage,
    questHubStatus,
} from "./questNetwork"

describe("isQuestAvailableOnNetwork", () => {
    // Mainnet (gnoland-1) has no memba_dao, candidature or token factory realm.
    it.each(["join-dao", "submit-candidature", "create-token"])(
        "%s is not available on mainnet",
        (id) => {
            expect(isQuestAvailableOnNetwork(id, "mainnet")).toBe(false)
        },
    )

    it.each(["join-dao", "submit-candidature", "create-token"])(
        "%s is available on a network with its realm (pearl)",
        (id) => {
            expect(isQuestAvailableOnNetwork(id, "pearl")).toBe(true)
        },
    )

    it("fails closed on an unknown network for realm-bound quests", () => {
        expect(isQuestAvailableOnNetwork("join-dao", "nope")).toBe(false)
    })

    it("does not gate quests that read no Memba realm", () => {
        expect(isQuestAvailableOnNetwork("register-username", "mainnet")).toBe(true)
        expect(isQuestAvailableOnNetwork("deploy-hello-realm", "mainnet")).toBe(true)
        expect(isQuestAvailableOnNetwork("connect-wallet", "nope")).toBe(true)
    })

    it("mirrors the realms the backend verifiers read", () => {
        expect(QUEST_REQUIRED_REALMS).toEqual({
            "join-dao": "gno.land/r/samcrew/memba_dao",
            "submit-candidature": "gno.land/r/samcrew/memba_dao_candidature_v3",
            "create-token": "gno.land/r/samcrew/tokenfactory_v2",
        })
    })
})

describe("notOnNetworkMessage", () => {
    it("turns the server's not-deployed rejection into a user message", () => {
        const err = new Error("[failed_precondition] not available on this network yet: gno.land/r/samcrew/memba_dao is not deployed")
        expect(notOnNetworkMessage(err)).toBe(
            "Not available on this network yet: gno.land/r/samcrew/memba_dao is not deployed.",
        )
    })

    it("returns null for any other rejection", () => {
        expect(notOnNetworkMessage(new Error("[failed_precondition] quest requirements not met on-chain"))).toBeNull()
        expect(notOnNetworkMessage("not an error")).toBeNull()
    })
})

describe("questHubStatus", () => {
    // join-dao needs memba_dao: live on test13, not deployed on mainnet.
    const none = new Set<string>()

    it("puts a quest whose realm is missing under Locked, not nowhere", () => {
        expect(questHubStatus("join-dao", none, "mainnet")).toBe("locked")
        expect(questHubStatus("join-dao", none, "test13")).toBe("available")
    })

    it("keeps completed quests completed wherever they are", () => {
        expect(questHubStatus("join-dao", new Set(["join-dao"]), "mainnet")).toBe("completed")
    })

    it("splits every open quest between Available and Locked", async () => {
        const { ALL_QUESTS } = await import("./gnobuilders")
        for (const net of ["mainnet", "test13"]) {
            for (const q of ALL_QUESTS) {
                expect(["available", "locked"]).toContain(questHubStatus(q.id, none, net))
            }
        }
    })
})
