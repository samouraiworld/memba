import { describe, expect, it } from "vitest"
import { launcherResults } from "./launchResults"

const ADDR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const ctx = { network: "mainnet", daos: [{ realmPath: "gno.land/r/gov/dao", name: "GovDAO" }, { realmPath: "gno.land/r/alice/team", name: "Alice Team" }] }

describe("launcherResults", () => {
    it("starts with a short list, and finds apps, DAOs and their sections by every word typed", () => {
        expect(launcherResults("", ctx)).toHaveLength(7)
        expect(launcherResults("wallet", ctx)[0]).toMatchObject({ title: "Wallet", spec: { key: "app:wallet" } })
        expect(launcherResults("alice members", ctx).map((r) => r.spec.key)).toEqual(["dao:alice.team"])
        expect(launcherResults("alice members", ctx)[0].spec.target).toEqual({ kind: "dao", name: "alice.team", section: "members" })
    })

    it("opens classic pages in the window that owns them, matching their hidden keywords too", () => {
        const hacker = launcherResults("import multisig", ctx).find((r) => r.id === "cmd:import-multisig")
        expect(hacker?.spec.target).toEqual({ kind: "app", app: "multisig", section: "import" })
        expect(launcherResults("gnoswap", ctx).some((r) => r.id === "cmd:extensions")).toBe(true)
        expect(launcherResults("create a dao", ctx)[0].spec.key).toBe("flow:dao")
    })

    it("finds About as a system command", () => {
        expect(launcherResults("about", ctx)[0]).toMatchObject({ id: "cmd:about", spec: { key: "about", app: null } })
    })

    it("turns a typed address into its profile and validator windows, and a realm path into its DAO", () => {
        const addr = launcherResults(ADDR, ctx)
        expect(addr.map((r) => r.spec.target)).toEqual([
            { kind: "app", app: "profile", section: ADDR },
            { kind: "app", app: "validators", section: ADDR },
        ])
        expect(launcherResults("https://gno.land/r/bob/club", ctx)[0].spec.target).toEqual({ kind: "dao", name: "bob.club", section: "overview" })
    })

    it("says nothing matched rather than guessing", () => {
        expect(launcherResults("zzqqxx", ctx)).toEqual([])
    })
})
