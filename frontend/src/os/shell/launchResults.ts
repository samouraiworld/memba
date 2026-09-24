/**
 * ⌘K search (mockup v4 launcherHTML/results): apps, DAOs and their sections,
 * an address or realm path typed in, and commands. The classic command list
 * (components/ui/commands.ts) is reused: each of its pages opens in the
 * window that owns it.
 *
 * @module os/shell/launchResults
 */
import { COMMANDS } from "../../components/ui/commands"
import { OS_APPS, type OsAppId } from "../apps"
import { nameForRealm } from "../daos/daoNames"
import { osTargetForClassic } from "../page/classicRoute"
import { appSpec, daoSpec, newDaoSpec, sendSpec, specForTarget, type WindowSpec } from "./windows"

export type LaunchIcon = { app: OsAppId } | { thing: "folder" | "doc" | "prof" }

export interface LaunchItem {
    id: string
    title: string
    sub: string
    icon: LaunchIcon
    spec: WindowSpec
    /** Extra words that match but aren't shown. */
    keywords?: string
}

export interface LaunchContext {
    network: string
    /** DAOs to offer: featured and saved in this browser. */
    daos: readonly { realmPath: string; name: string }[]
}

const ADDRESS = /^g1[02-9ac-hj-np-z]{38}$/
const REALM = /^gno\.land\/r\/[a-z0-9_./-]+$/

function typed(q: string, ctx: LaunchContext): LaunchItem[] {
    const v = q.trim()
    if (ADDRESS.test(v)) {
        const profile = osTargetForClassic(`/${ctx.network}/profile/${v}`, ctx.network)
        const validator = osTargetForClassic(`/${ctx.network}/validators/${v}`, ctx.network)
        const out: LaunchItem[] = []
        if (profile) out.push({ id: `addr:${v}`, title: v, sub: "Address · open profile", icon: { app: "profile" }, spec: specForTarget(profile)! })
        if (validator) out.push({ id: `val:${v}`, title: v, sub: "Address · open as a validator", icon: { app: "validators" }, spec: specForTarget(validator)! })
        return out
    }
    const path = v.replace(/^https?:\/\/[^/]+\//, "gno.land/").replace(/\/$/, "")
    if (REALM.test(path)) {
        const name = nameForRealm(path)
        if (name) return [{ id: `realm:${path}`, title: path, sub: "Realm · open as a DAO", icon: { thing: "folder" }, spec: daoSpec(name) }]
    }
    return []
}

function all(ctx: LaunchContext): LaunchItem[] {
    const out: LaunchItem[] = OS_APPS.map((a) => ({ id: `app:${a.id}`, title: a.name, sub: `App · ${a.summary}`, icon: { app: a.id }, spec: appSpec(a.id) }))
    for (const d of ctx.daos) {
        const name = nameForRealm(d.realmPath)
        if (!name) continue
        out.push({ id: `dao:${name}`, title: d.name, sub: `DAO · ${d.realmPath}`, icon: { thing: "folder" }, spec: daoSpec(name) })
        out.push({ id: `dao:${name}:proposals`, title: `${d.name} › Proposals`, sub: "DAO section", icon: { thing: "doc" }, spec: daoSpec(name, "proposals") })
        out.push({ id: `dao:${name}:members`, title: `${d.name} › Members`, sub: "DAO section", icon: { thing: "prof" }, spec: daoSpec(name, "members") })
    }
    out.push({ id: "cmd:new-dao", title: "Create a DAO", sub: "Command · DAOs", icon: { app: "daos" }, spec: newDaoSpec() })
    out.push({ id: "cmd:send", title: "Send GNOT", sub: "Command · Wallet", keywords: "transfer pay", icon: { app: "wallet" }, spec: sendSpec() })
    for (const c of COMMANDS) {
        if (!c.path || c.path === "/" || c.path === "/dashboard" || c.path === "/dao/create") continue
        const t = osTargetForClassic(`/${ctx.network}${c.path}`, ctx.network)
        const spec = t ? specForTarget(t) : null
        if (!spec || (t?.kind === "app" && t.section === null)) continue // an app's home is already listed
        out.push({ id: `cmd:${c.id}`, title: c.label, sub: `Page · ${c.section}`, keywords: c.keywords?.join(" "), icon: { app: spec.app ?? "daos" }, spec })
    }
    return out
}

/** What ⌘K shows for a query: typed addresses and realms first, then matches; a short start list when empty. */
export function launcherResults(query: string, ctx: LaunchContext): LaunchItem[] {
    const q = query.trim().toLowerCase()
    if (!q) return all(ctx).slice(0, 7)
    const words = q.split(/\s+/)
    // Title matches rank above matches in the description or keywords.
    const rank = (x: LaunchItem) => { const t = x.title.toLowerCase(); return t.startsWith(q) ? 0 : words.every((w) => t.includes(w)) ? 1 : 2 }
    const matches = all(ctx)
        .filter((x) => { const hay = `${x.title} ${x.sub} ${x.keywords ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
        .map((x, i) => ({ x, i, r: rank(x) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(({ x }) => x)
    return [...typed(query, ctx), ...matches].slice(0, 9)
}
