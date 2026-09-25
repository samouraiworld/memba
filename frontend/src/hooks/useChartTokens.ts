import { useMemo, useSyncExternalStore } from "react"

const TOKEN_KEYS = [
    "--gl-color-chart-bg",
    "--gl-color-chart-grid",
    "--gl-color-chart-axis-fg",
    "--gl-color-chart-tooltip-border",
    "--gl-color-chart-series-primary",
    "--gl-color-chart-series-reviewed",
    "--gl-color-chart-series-open",
    "--gl-color-chart-series-commits",
    "--gl-color-chart-series-issues",
    "--gl-color-chart-series-danger",
    "--gl-color-chart-series-neutral",
] as const

type TokenKey = (typeof TOKEN_KEYS)[number]
type TokenMap = Record<TokenKey, string>

function readTokens(): TokenMap {
    // Inside Memba OS the chart sits in a window whose tokens are the Aqua ones (os/classic-bridge.css).
    // ".os-classic" only ever exists nested in the OS root (checked via the bundle-isolation gate, so
    // this file can't literally reference the OS root's own class name). With several OS windows open
    // this picks the first one: the bridge values are identical in every window (they all follow the
    // same OS theme), so which window answers doesn't matter.
    const source = document.querySelector(".os-classic") ?? document.documentElement
    const style = getComputedStyle(source)
    const map = {} as TokenMap
    for (const key of TOKEN_KEYS) {
        map[key] = style.getPropertyValue(key).trim()
    }
    return map
}

let cached: TokenMap | null = null
let listeners: Array<() => void> = []

function subscribe(cb: () => void) {
    if (listeners.length === 0) {
        const observer = new MutationObserver(() => {
            cached = null
            listeners.forEach(l => l())
        })
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme", "class", "style"],
        })
    }
    // A subscriber mounting now (e.g. a chart inside a freshly-opened OS window) must not reuse a
    // `cached` value read before it existed - reset it so the next getSnapshot() re-reads the DOM.
    cached = null
    listeners.push(cb)
    return () => {
        listeners = listeners.filter(l => l !== cb)
    }
}

function getSnapshot(): TokenMap {
    if (!cached) cached = readTokens()
    return cached
}

export function useChartTokens() {
    const tokens = useSyncExternalStore(subscribe, getSnapshot)

    return useMemo(() => ({
        bg: tokens["--gl-color-chart-bg"],
        grid: tokens["--gl-color-chart-grid"],
        axisFg: tokens["--gl-color-chart-axis-fg"],
        tooltipBorder: tokens["--gl-color-chart-tooltip-border"],
        primary: tokens["--gl-color-chart-series-primary"],
        reviewed: tokens["--gl-color-chart-series-reviewed"],
        open: tokens["--gl-color-chart-series-open"],
        commits: tokens["--gl-color-chart-series-commits"],
        issues: tokens["--gl-color-chart-series-issues"],
        danger: tokens["--gl-color-chart-series-danger"],
        neutral: tokens["--gl-color-chart-series-neutral"],
    }), [tokens])
}
