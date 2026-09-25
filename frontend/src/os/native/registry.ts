/**
 * Native Memba OS windows, one folder per app: src/os/apps/<appId>/native.tsx
 * (default export). Adding an app edits no shared file, so parallel app PRs
 * don't conflict. Lazy: each app's code loads when its window first opens.
 *
 * Precedence: WindowFrame's Body handles some targets itself before it ever
 * asks this registry — the DAOs app (list and "new"), DAO folders, proposals
 * and new-proposal wizards, the Wallet app (home and send), multisig windows
 * and the Multisig app home, and the feedback window. A `native.tsx` for
 * daos, wallet or multisig only takes the sections Body doesn't claim.
 *
 * @module os/native/registry
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import { OS_APPS, type OsAppId } from "../apps"
import type { NativeViewProps } from "./types"

type Loader = () => Promise<{ default: ComponentType<NativeViewProps> }>

export function resolveNative(modules: Record<string, Loader>, app: OsAppId): Loader | undefined {
    return modules[`../apps/${app}/native.tsx`]
}

const MODULES = import.meta.glob<{ default: ComponentType<NativeViewProps> }>("../apps/*/native.tsx")

/** The glob keys of every native.tsx folder in the build. */
export function nativeModuleKeys(): string[] {
    return Object.keys(MODULES)
}

const APP_IDS = new Set<string>(OS_APPS.map((a) => a.id))

/** Glob keys whose folder isn't an OS app id (a typo'd folder would never open). */
export function unknownNativeFolders(keys: string[]): string[] {
    return keys.filter((k) => {
        const m = /^\.\.\/apps\/([^/]+)\/native\.tsx$/.exec(k)
        return !m || !APP_IDS.has(m[1])
    })
}
// Scoped per `modules` map (a WeakMap keyed by that object), not by app id alone: two
// different modules maps must never share a cached component for the same app id, even
// if it's the same app id, since they can resolve to different loaders.
const caches = new WeakMap<Record<string, Loader>, Map<OsAppId, LazyExoticComponent<ComponentType<NativeViewProps>>>>()

/**
 * Cache-backed lookup, taking `modules` so tests can pin identity stability
 * against a fixture instead of the real glob. `nativeView` below is the
 * public entry point and delegates here with `MODULES`.
 */
export function nativeViewFrom(modules: Record<string, Loader>, app: OsAppId): LazyExoticComponent<ComponentType<NativeViewProps>> | undefined {
    const load = resolveNative(modules, app)
    if (!load) return undefined
    let cache = caches.get(modules)
    if (!cache) { cache = new Map(); caches.set(modules, cache) }
    let view = cache.get(app)
    if (!view) { view = lazy(load); cache.set(app, view) }
    return view
}

export function nativeView(app: OsAppId): LazyExoticComponent<ComponentType<NativeViewProps>> | undefined {
    return nativeViewFrom(MODULES, app)
}
