import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { readThemePref, useOsTheme, writeThemePref, type OsTheme, type OsThemePref } from "./theme"
import { DEFAULT_WALLPAPER, getWallpaper, type Wallpaper } from "./wallpapers"

export const OS_WALLPAPER_KEY = "memba_os_wallpaper"
export const OS_ICON_SIZE_KEY = "memba_os_icon_size"
export type OsIconSize = "small" | "medium" | "large"

function read(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
    } catch { /* A private window can keep this visit's state without persistence. */ }
}

export function readWallpaperId(): string {
    return getWallpaper(read(OS_WALLPAPER_KEY)).id
}

export function readIconSize(): OsIconSize {
    const value = read(OS_ICON_SIZE_KEY)
    return value === "small" || value === "large" ? value : "medium"
}

export interface OsAppearance {
    themePref: OsThemePref
    theme: OsTheme
    wallpaper: Wallpaper
    iconSize: OsIconSize
    setThemePref: (value: OsThemePref) => void
    setWallpaperId: (id: string) => void
    setIconSize: (value: OsIconSize) => void
    reset: () => void
}

export const AppearanceContext = createContext<OsAppearance | null>(null)

export function useOsAppearance(): OsAppearance {
    const appearance = useContext(AppearanceContext)
    if (!appearance) throw new Error("Memba OS appearance is unavailable")
    return appearance
}

/** One source of truth for the OS root, native Settings, and both device layouts. */
export function useAppearanceState(): OsAppearance {
    const [themePref, setThemePrefState] = useState(readThemePref)
    const [wallpaperId, setWallpaperIdState] = useState(readWallpaperId)
    const [iconSize, setIconSizeState] = useState(readIconSize)
    const theme = useOsTheme(themePref)

    const setThemePref = useCallback((value: OsThemePref) => {
        writeThemePref(value)
        setThemePrefState(value)
    }, [])
    const setWallpaperId = useCallback((id: string) => {
        const value = getWallpaper(id).id
        write(OS_WALLPAPER_KEY, value === DEFAULT_WALLPAPER.id ? null : value)
        setWallpaperIdState(value)
    }, [])
    const setIconSize = useCallback((value: OsIconSize) => {
        write(OS_ICON_SIZE_KEY, value === "medium" ? null : value)
        setIconSizeState(value)
    }, [])
    const reset = useCallback(() => {
        writeThemePref("auto")
        write(OS_WALLPAPER_KEY, null)
        write(OS_ICON_SIZE_KEY, null)
        setThemePrefState("auto")
        setWallpaperIdState(DEFAULT_WALLPAPER.id)
        setIconSizeState("medium")
    }, [])

    useEffect(() => {
        const sync = (event: StorageEvent) => {
            if (event.storageArea && event.storageArea !== localStorage) return
            if (event.key === null || event.key === "memba_os_theme") setThemePrefState(readThemePref())
            if (event.key === null || event.key === OS_WALLPAPER_KEY) setWallpaperIdState(readWallpaperId())
            if (event.key === null || event.key === OS_ICON_SIZE_KEY) setIconSizeState(readIconSize())
        }
        window.addEventListener("storage", sync)
        return () => window.removeEventListener("storage", sync)
    }, [])

    return { themePref, theme, wallpaper: getWallpaper(wallpaperId), iconSize, setThemePref, setWallpaperId, setIconSize, reset }
}
