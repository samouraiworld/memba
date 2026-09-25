/**
 * Native Memba OS windows, one folder per app: src/os/apps/<appId>/native.tsx
 * (default export). Adding an app edits no shared file, so parallel app PRs
 * don't conflict. Lazy: each app's code loads when its window first opens.
 *
 * @module os/native/registry
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { OsAppId } from "../apps"
import type { NativeViewProps } from "./types"

type Loader = () => Promise<{ default: ComponentType<NativeViewProps> }>

export function resolveNative(modules: Record<string, Loader>, app: OsAppId): Loader | undefined {
    return modules[`../apps/${app}/native.tsx`]
}

const MODULES = import.meta.glob<{ default: ComponentType<NativeViewProps> }>("../apps/*/native.tsx")
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
