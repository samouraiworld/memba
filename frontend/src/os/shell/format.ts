import { getApp, type OsAppId } from "../apps"

/** g1abcdef…wxyz */
export function shortAddr(a: string): string {
    return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

/** The page an app opens in the current Memba, relative to /:network (null: none yet). */
export function classicPath(app: OsAppId): string | null {
    if (app === "wallet") return "" // balances live on the home page today
    const route = getApp(app).routes.find((r) => !r.includes(":") && !r.includes("*"))
    return route ?? null
}
