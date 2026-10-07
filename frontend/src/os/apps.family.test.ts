import { describe, expect, it } from "vitest"
import { appsOn, getApp, OS_APPS, runsOn } from "./apps"

describe("Memba OS apps per network family", () => {
    it("runs every app on gno.land: the list is the registry itself", () => {
        expect(appsOn(OS_APPS, "gno")).toBe(OS_APPS)
    })

    it("offers on an EVM network only the apps that need no Gno chain", () => {
        expect(appsOn(OS_APPS, "evm").map((a) => a.id)).toEqual(["settings", "news", "meet"])
    })

    it("keeps the Gno-specific apps off EVM networks", () => {
        for (const id of ["validators", "terminal", "daos", "wallet", "multisig", "tokens", "profile", "devreport"] as const) {
            expect(runsOn(getApp(id), "evm")).toBe(false)
            expect(runsOn(getApp(id), "gno")).toBe(true)
        }
    })
})
