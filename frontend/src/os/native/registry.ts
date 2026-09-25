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
const cache = new Map<OsAppId, LazyExoticComponent<ComponentType<NativeViewProps>>>()

/**
 * Cache-backed lookup, taking `modules` so tests can pin identity stability
 * against a fixture instead of the real glob. `nativeView` below is the
 * public entry point and delegates here with `MODULES`.
 */
export function nativeViewFrom(modules: Record<string, Loader>, app: OsAppId): LazyExoticComponent<ComponentType<NativeViewProps>> | undefined {
    const load = resolveNative(modules, app)
    if (!load) return undefined
    let view = cache.get(app)
    if (!view) { view = lazy(load); cache.set(app, view) }
    return view
}

export function nativeView(app: OsAppId): LazyExoticComponent<ComponentType<NativeViewProps>> | undefined {
    return nativeViewFrom(MODULES, app)
}
