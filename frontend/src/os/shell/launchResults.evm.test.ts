import { describe, expect, it } from "vitest"
import { launcherResults } from "./launchResults"

const onBase = { network: "base-sepolia", family: "evm" as const, daos: [{ realmPath: "gno.land/r/gov/dao", name: "GovDAO" }] }

describe("launcherResults on an EVM network", () => {
    it("lists only the apps that run there, and About", () => {
        expect(launcherResults("", onBase).map((r) => r.id)).toEqual(["app:multisig", "app:settings", "app:news", "app:meet", "cmd:about"])
    })

    it("finds no Gno DAO, command or page", () => {
        for (const q of ["govdao", "create a dao", "send gnot", "import multisig", "validators"]) expect(launcherResults(q, onBase)).toEqual([])
    })

    it("does not read a Gno address or realm path", () => {
        expect(launcherResults("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", onBase)).toEqual([])
        expect(launcherResults("gno.land/r/bob/club", onBase)).toEqual([])
    })
})
