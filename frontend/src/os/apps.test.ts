import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { appForRoute, DOCK_APPS, getApp, OS_APPS, OS_SYSTEM_ROUTES } from "./apps"

// Every `path="…"` in the route table (App.tsx + routes/networkRoutes.tsx), as written (nested gnolove children are bare).
const appTsx = ["../App.tsx", "../routes/networkRoutes.tsx"].map((f) => readFileSync(resolve(__dirname, f), "utf8")).join("\n")
const appRoutes = [...appTsx.matchAll(/path="([^"]+)"/g)].map((m) => m[1])

const registered = [...OS_APPS.flatMap((a) => a.routes), ...OS_SYSTEM_ROUTES.map((s) => s.route)]
/** A registry entry matches an App.tsx path exactly, or as the child of a registered parent. */
const matches = (entry: string, raw: string) => entry === raw || entry.endsWith(`/${raw}`) && registered.includes(entry.slice(0, -raw.length - 1))

describe("Memba OS app registry", () => {
    it("reads the routes out of App.tsx", () => {
        expect(appRoutes.length).toBeGreaterThan(60)
    })

    it("gives every route in App.tsx a home", () => {
        const orphans = appRoutes.filter((raw) => !registered.some((entry) => matches(entry, raw)))
        expect(orphans).toEqual([])
    })

    it("only registers routes that still exist in App.tsx", () => {
        const stale = registered.filter((entry) => !appRoutes.some((raw) => matches(entry, raw)))
        expect(stale).toEqual([])
    })

    it("never gives one route to two apps", () => {
        expect(new Set(registered).size).toBe(registered.length)
    })

    it("keeps ids and URL slugs unique", () => {
        expect(new Set(OS_APPS.map((a) => a.id)).size).toBe(OS_APPS.length)
        expect(new Set(OS_APPS.map((a) => a.slug)).size).toBe(OS_APPS.length)
        OS_APPS.forEach((a) => expect(a.slug).toMatch(/^[a-z][a-z-]*$/))
    })

    it("puts the XP leaderboard in Quests, not Arcade", () => {
        expect(appForRoute("leaderboard")?.id).toBe("quests")
    })

    it("names the gnolove app Dev Report at /os/dev-report", () => {
        expect(getApp("devreport")).toMatchObject({ name: "Dev Report", slug: "dev-report" })
    })

    it("docks the seven core apps", () => {
        expect(DOCK_APPS.map((a) => a.id)).toEqual(["daos", "wallet", "multisig", "feed", "store", "arcade", "validators"])
    })

    it("throws on an unknown id", () => {
        // @ts-expect-error — deliberately invalid id
        expect(() => getApp("nope")).toThrow(/Unknown Memba OS app/)
    })
})
